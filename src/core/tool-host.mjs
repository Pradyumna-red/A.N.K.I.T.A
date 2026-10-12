import { specs, get, needsApproval, isReadOnly, displayArgs } from '../../tools/index.mjs';
import { DEFAULT_TOOL_OUTPUT_BYTES } from './config.mjs';
import { capOutput } from '../../tools/shared/_shared.mjs';
import { redactText, configuredSecrets } from './redact.mjs';
import { focusAllows } from './tool-focus.mjs';
import { runFileToolInWorker } from '../tooling/tool-worker.mjs';
import { primitiveBrowserCost } from '../../tools/browser/operations.mjs';
import { captureBrowserEvidence, recordBrowserProgress } from './browser-progress.mjs';
import { isToolFailure } from './verify.mjs';
import { browserScreenshotImage } from '../../tools/browser/screenshots.mjs';
import { isBrowserMcpTool, MANAGED_BROWSER_REQUIRED } from '../integrations/browser-routing.mjs';
import { parseToolName } from '../integrations/mcp-manager.mjs';
import { TIER_DENY } from '../integrations/mcp-tiers.mjs';
import { COMPUTER_MCP_ID, COMPUTER_DIRECT_CONFIG, COMPUTER_POINTER_SESSION, COMPUTER_TOOLS, computerObservationTargets, formatComputerTargets } from '../integrations/computer-use.mjs';
import { validMcpImage, MAX_MCP_IMAGES_PER_TURN } from '../integrations/mcp-images.mjs';
import { JOB_EXECUTION_COMPLETE } from '../automation/job-policy.mjs';
import { TOOL_RESULT_MODE } from '../integrations/chatgpt-browser/protocol.mjs';
import { c, preview, short, clip } from './ui.mjs';
import { renderDiff } from '../../tools/shared/_diff.mjs';

export const TOOL_UI = { ...c, preview, short, clip };
TOOL_UI.diff = (oldText, newText, opts = {}) => renderDiff(oldText, newText, { ui: TOOL_UI, ...opts });

// Calls/request: shared with the API loop so browser hosts use the same limits.
export const MAX_TOOL_CALLS = 60;
export const MAX_WEB_SEARCHES_PER_TURN = 6;
export const MAX_REPEAT_CALLS = 3;
const FILE_WORKER_TOOLS = new Set(['search_files', 'glob', 'list_dir', 'read_file']);
const DEFAULT_OUTPUT_COLUMNS = 80; // Terminal columns when no interactive TTY supplies a width.
const CANCELLED = 'Action cancelled by user.';
const DENIED = 'The user denied permission for this action. Do not retry it; ask what to do instead.';
const MCP_PREFIX = 'mcp__'; // Existing namespaced registry contract.
const MCP_MODE = TOOL_RESULT_MODE.mcp;
const READ_ONLY_DENIAL = 'Error: this host is read-only.';
const automaticApproval = ctx => ctx.autoApprove === undefined ? ctx.config.autoApprove === true : ctx.autoApprove === true; // Current host policy wins over an older config snapshot.
const textResult = text => ({ content: [{ type: 'text', text: String(text) }], isError: isToolFailure(String(text)) || text === CANCELLED || text === DENIED });

/** Execution only: no model client, conversation loop or API history. Context is host-owned.
 * A context getter lets an API Agent share its current request counters after project/Stop changes.
 */
export class ToolHost {
  constructor({ context, mcp = null, authorize, onEvent } = {}) {
    if (!context) throw new TypeError('ToolHost requires an explicit host context');
    this.context = context; this.mcp = mcp; this.authorize = authorize; this.onEvent = onEvent;
    this.controller = new AbortController();
    this.requestState = { searchesThisTurn: 0, browserActionsThisTurn: 0, activeSkillTools: new Set() };
  }

  currentContext() { return typeof this.context === 'function' ? this.context() : this.context; }
  specs() {
    const ctx = this.currentContext();
    const local = specs.filter(spec => (!ctx.allowedTools || ctx.allowedTools.has(spec.function.name)) &&
      (!ctx.readOnly || isReadOnly(spec.function.name, {}, ctx))).map(spec => ({
      name: spec.function.name, description: spec.function.description, inputSchema: spec.function.parameters,
      annotations: { readOnlyHint: isReadOnly(spec.function.name, {}, ctx) },
    }));
    // A read-only proof surface deliberately publishes only local audited read tools.
    return local;
  }

  async cancel() { this.controller.abort(); }

  async execute(call, { signal, resultMode = MCP_MODE } = {}) {
    const base = this.currentContext();
    const config = base.config ?? {};
    const state = base.executionState ?? this.requestState;
    const args = call.arguments ?? {};
    const name = call.name;
    const combined = AbortSignal.any([this.controller.signal, signal, base.signal].filter(Boolean));
    const ctx = { ...base, config, state: base.state ?? { activatedTools: new Set() }, signal: combined, ui: base.ui ?? TOOL_UI,
      width: base.width ?? process.stdout.columns ?? DEFAULT_OUTPUT_COLUMNS,
      browserCallId: call.id, mcp: base.mcp ?? this.mcp };
    const budget = config.maxToolChars > 0 ? config.maxToolChars : DEFAULT_TOOL_OUTPUT_BYTES;
    if (combined.aborted) return textResult(CANCELLED);
    if (!args || typeof args !== 'object' || Array.isArray(args)) return textResult('Error: arguments must be an object.');
    if (!focusAllows(ctx.state, name)) return textResult('Error: This tool is outside the current tool focus. Use find_tools with scope="general" to explicitly change methods before executing it.');
    if (ctx.allowedTools && !ctx.allowedTools.has(name)) return textResult(ctx.backgroundToolScope
      ? 'Error: This tool is not available in background browser jobs.'
      : 'Error: This tool is not available in this execution context.');
    this.onEvent?.({ type: 'tool-call', call });
    let result;
    try {
      result = String(name).startsWith(MCP_PREFIX)
        ? await this.executeMcp(call, args, ctx, state, resultMode, budget)
        : await this.executeLocal(call, args, ctx, state, resultMode, budget);
    } catch (error) { result = textResult(`Error while running ${name}: ${error.message}`); }
    this.onEvent?.({ type: 'tool-result', call, result });
    return result;
  }

  async executeMcp(call, args, ctx, state, resultMode, budget) {
    const name = call.name;
    const mcp = ctx.mcp;
    const found = mcp?.findTool(name);
    const native = parseToolName(name);
    if (ctx.browserManager && isBrowserMcpTool(name, [{ id: native?.serverId, tools: found?.record?.tools || [] }])) {
      ctx.state.activatedTools.add('browser'); return textResult(MANAGED_BROWSER_REQUIRED);
    }
    if (!found) return textResult(`Error: no connected MCP server provides "${name}".`);
    if (ctx.readOnly && found.tool?.annotations?.readOnlyHint !== true) return textResult(READ_ONLY_DENIAL);
    const direct = ctx.config[COMPUTER_DIRECT_CONFIG] === true && native?.serverId === COMPUTER_MCP_ID && COMPUTER_TOOLS.includes(native.toolName);
    const pointer = found.record?.[COMPUTER_POINTER_SESSION];
    if (direct && pointer && found.tool?.inputSchema?.properties?.session) args = { ...args, session: pointer };
    const decision = mcp.tierFor?.(name, args);
    if (decision?.tier === TIER_DENY) {
      mcp.recordTierDecision?.(name, 'denied');
      return textResult(`Error: ${decision.label} is blocked by the approval tiers. Do not retry it; ask the user whether the tier rule should change.`);
    }
    if (direct) mcp.recordTierDecision?.(name, 'allowed');
    if (!direct && mcp.needsApproval(name, args) && !automaticApproval(ctx)) {
      const ok = await this.authorize?.(name, mcp.approvalDetail(name, args));
      mcp.recordTierDecision?.(name, ok === true ? 'allowed' : 'denied');
      if (ok !== true) return textResult(DENIED);
    }
    if (ctx.signal.aborted) return textResult(CANCELLED);
    if (!mcp.callToolResult) return textResult(await mcp.callTool(name, args, { signal: ctx.signal }));
    const result = await mcp.callToolResult(name, args, { signal: ctx.signal });
    const raw = result?.raw ?? result;
    const nativeResult = { content: Array.isArray(raw?.content) ? raw.content : [{ type: 'text', text: result?.text ?? '' }],
      ...(result?.text !== undefined ? { text: result.text } : {}),
      ...(raw?.structuredContent ? { structuredContent: raw.structuredContent } : {}),
      isError: Boolean(result?.isError || raw?.isError) };
    if (resultMode !== MCP_MODE) return nativeResult;
    const targets = native?.serverId === COMPUTER_MCP_ID ? computerObservationTargets(nativeResult) : null;
    const targetText = formatComputerTargets(targets, budget);
    const remaining = Math.max(0, budget - Buffer.byteLength(targetText));
    const text = nativeResult.content.filter(part => part?.type === 'text').map(part => part.text).join('\n');
    const content = [{ type: 'text', text: (remaining ? capOutput(text, remaining) : '') + targetText }];
    for (const part of nativeResult.content) {
      if (!nativeResult.isError && part?.type === 'image' && validMcpImage(part) && (state.nativeImagesThisTurn || 0) < MAX_MCP_IMAGES_PER_TURN) {
        content.push({ type: 'image', mimeType: part.mimeType, data: part.data });
        state.nativeImagesThisTurn = (state.nativeImagesThisTurn || 0) + 1;
      }
    }
    return { content, isError: nativeResult.isError };
  }

  async executeLocal(call, args, ctx, state, resultMode, budget) {
    const tool = get(call.name);
    if (!tool) return textResult(`Error: unknown tool "${call.name}".`);
    if (ctx.readOnly && !isReadOnly(tool.name, args, ctx)) return textResult(READ_ONLY_DENIAL);
    if (tool.name === 'skill' && !(ctx.skillsInteractive ?? ctx.skillsEnabled)) return textResult('Error: skills are available only in interactive chats.');
    if (tool.name === 'skill' && ctx.disabledSkills?.has(String(args.name || '').trim().toLowerCase())) return textResult(`Error: skill "${args.name}" is disabled in Plugins > Skills.`);
    if (tool.name === 'web_search') {
      const completion = ctx.config.backgroundJob && ctx.config.backgroundExecutionPolicy === JOB_EXECUTION_COMPLETE;
      if (!completion && state.searchesThisTurn >= MAX_WEB_SEARCHES_PER_TURN) return textResult(`Search limit reached (${MAX_WEB_SEARCHES_PER_TURN} web searches for this request). Use the results already gathered and answer the user; do not try another search tool for the same query.`);
      state.searchesThisTurn++;
    }
    ctx.onToolsActivated = names => { for (const name of names) state.activeSkillTools.add(name); };
    ctx.onBrowserActionResult = result => {
      ctx.browserResultCallback?.(result);
      if (ctx.config.browserEvidenceRetention === true) state.browserEvidence = captureBrowserEvidence(state.browserEvidence, result, call.id);
      if (ctx.config.browserProgressTracking === true) state.browserProgress = recordBrowserProgress(state.browserProgress, result, { maxRepeats: MAX_REPEAT_CALLS });
    };
    const automatic = automaticApproval(ctx);
    if (needsApproval(tool.name, args, ctx)) {
      if (automatic && tool.neverAutoApprove?.(args, ctx) === true) return textResult(`Error: ${tool.name} can change approval settings, which auto-approve is not allowed to do. Ask the user to run it interactively.`);
      const preview = tool.approval ? await tool.approval(args, ctx, ctx.ui) : null;
      const detail = redactText(typeof preview === 'string' && preview.trim() ? preview :
        `${tool.name}\n\n${JSON.stringify(displayArgs(tool.name, args, ctx), null, 2)}`, { secrets: configuredSecrets(process.env, ctx.config) });
      if (!automatic && await this.authorize?.(tool.name, detail) !== true) return textResult(DENIED);
    }
    if (ctx.signal.aborted) return textResult(CANCELLED);
    state.activeSkillTools.add(tool.name);
    if (tool.name === 'browser' && ctx.config.browserRuntimeV2 === true) {
      const limit = ctx.config.maxToolCalls > 0 ? ctx.config.maxToolCalls : MAX_TOOL_CALLS;
      const cost = primitiveBrowserCost(args);
      if ((state.browserActionsThisTurn || 0) + cost > limit) return textResult(`Error: Browser primitive action budget (${limit} this turn) is exhausted. Inspect existing receipts and report unfinished work.`);
      state.browserActionsThisTurn = (state.browserActionsThisTurn || 0) + cost;
    }
    let output = FILE_WORKER_TOOLS.has(tool.name) ? await runFileToolInWorker(tool.name, args, ctx) : await tool.run(args, ctx);
    if (tool.name === 'browser' && typeof output === 'string' && !isToolFailure(output)) {
      const guidance = [ctx.config.browserProgressTracking === true ? state.browserProgress?.guidance : null,
        ctx.config.browserEvidenceRetention === true ? state.browserEvidence?.notice : null].filter(Boolean);
      if (guidance.length) output += '\nBrowser read-back guidance: ' + guidance.join(' ');
    }
    await ctx.onLocalResult?.(tool.name, args, output, ctx);
    const result = textResult(capOutput(output, budget));
    if (resultMode === MCP_MODE && tool.name === 'browser' && args.action === 'screenshot' && !result.isError) {
      const image = browserScreenshotImage(output, ctx);
      if (image) {
        const [mimeType, data] = image.dataUrl.slice('data:'.length).split(';base64,');
        result.content.push({ type: 'image', mimeType, data });
      }
    }
    return result;
  }
}
