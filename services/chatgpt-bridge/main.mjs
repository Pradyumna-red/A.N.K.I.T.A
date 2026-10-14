import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createCompanionBridge } from './server.mjs';
import { GATEWAY_TOKEN_BYTES } from '../../src/integrations/chatgpt-browser/protocol.mjs';
import { ToolHost } from '../../src/core/tool-host.mjs';
import { createToolGateway } from '../../src/integrations/chatgpt-browser/tool-gateway.mjs';
import { MemoryToolReceipts } from '../../src/integrations/chatgpt-browser/tool-receipts.mjs';
import { COMPANION_POLL_MS, BRIDGE_READY_STATUS, MODEL_MODES } from './config.mjs';

const PROOF_FLAG = '--proof'; // Explicit scratch-only attach check; no user workspace exposure.
const PAIRING_DISPLAY_FLAG = '--print-pairing'; // Owner-requested one-time setup display; never emitted in diagnostic logs.
const WORKSPACE_FLAG = '--workspace';
const TEMP_PREFIX = 'ankita-chatgpt-account-proof-';
const PROOF_FILE_NAME = 'native-proof.txt';

export async function startCompanionProof({ workspacePath, onObservation } = {}) {
  const scratch = !workspacePath;
  const workspace = scratch ? fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)) : fs.realpathSync(workspacePath);
  const key = randomBytes(GATEWAY_TOKEN_BYTES).toString('base64url');
  const proofBytes = scratch ? `ANKITA native proof ${randomUUID()}` : null;
  if (scratch) fs.writeFileSync(path.join(workspace, PROOF_FILE_NAME), proofBytes);
  let gateway = null, gatewayLease = null, gatewayWork = Promise.resolve(), nativeReadMatched = false;
  const host = new ToolHost({ context: { cwd: workspace, workspacePath: workspace, config: {}, readOnly: true, allowedTools: new Set(['read_file']) },
    onEvent: event => {
      if (event.type === 'tool-result' && proofBytes && !event.result.isError && event.result.content.some(part => part.type === 'text' && part.text.split('\n')[0] === `1: ${proofBytes}`)) nativeReadMatched = true;
    } });
  const bridge = await createCompanionBridge({ config: { workspacePath: workspace, threadId: randomUUID(), modelMode: MODEL_MODES.current },
    // Ephemeral proof credentials have no disk record. Desktop persistence will inject SecureStore.
    secrets: { withSecret: async (_, callback) => callback(key) }, onObservation: observation => {
      gatewayWork = gatewayWork.then(async () => {
        if (bridge.view().status !== BRIDGE_READY_STATUS || gatewayLease === observation.binding.leaseId) return;
        await gateway?.close();
        gatewayLease = observation.binding.leaseId;
        gateway = await createToolGateway({ leaseId: gatewayLease,
          hostForLease: id => { if (id !== gatewayLease || bridge.view().binding?.leaseId !== id) throw new Error('Stale proof lease'); return host; },
          resolveRequestOwner: input => bridge.resolveRequestOwner(input), receipts: new MemoryToolReceipts() });
      }).catch(() => { gateway = null; gatewayLease = null; });
      onObservation?.(observation);
    } });
  let closePromise;
  return { bridge, workspacePath: workspace, proofFile: scratch ? PROOF_FILE_NAME : null,
    pairingUrl: `${bridge.address}/#${key}`, gateway: () => gateway,
    proofStatus: () => ({ nativeReadMatched, gatewayReady: Boolean(gateway), accountStatus: bridge.view().status }),
    close() { closePromise ??= (async () => { await gatewayWork; await gateway?.close(); await bridge.close(); if (scratch) fs.rmSync(workspace, { recursive: true, force: true }); })(); return closePromise; } };
}
async function main() {
  const args = process.argv.slice(2);
  const workspaceIndex = args.indexOf(WORKSPACE_FLAG);
  if (!args.includes(PROOF_FLAG) && workspaceIndex < 0) throw new Error(`Choose ${PROOF_FLAG} or ${WORKSPACE_FLAG} with an explicit directory`);
  if (workspaceIndex >= 0 && !args[workspaceIndex + 1]) throw new Error('Workspace directory is missing');
  const proof = await startCompanionProof({ workspacePath: workspaceIndex < 0 ? undefined : args[workspaceIndex + 1],
    onObservation: observation => console.log(JSON.stringify({ event: 'bound-model-observation', selectedModel: observation.selectedModel, models: observation.models.length, modelMode: observation.modelMode, observationReason: observation.observationReason })) });
  console.log(JSON.stringify({ status: proof.bridge.view().status, address: proof.bridge.address, proofFile: proof.proofFile, hostedNativeMcp: 'not-proven' }));
  if (args.includes(PAIRING_DISPLAY_FLAG)) console.log('ONE-TIME LOCAL PAIRING URL (keep private): ' + proof.pairingUrl);
  let displayedGateway = null, reportedNativeMatch = false;
  const statusTimer = setInterval(() => {
    const gateway = proof.gateway();
    if (args.includes(PAIRING_DISPLAY_FLAG) && gateway && displayedGateway !== gateway.url) {
      displayedGateway = gateway.url;
      console.log('READ-ONLY NATIVE MCP URL (requires supported HTTPS/tunnel setup, keep private): ' + gateway.url);
    }
    if (proof.proofStatus().nativeReadMatched && !reportedNativeMatch) {
      reportedNativeMatch = true; console.log(JSON.stringify({ hostedNativeMcp: 'attributed-file-bytes-matched' }));
    }
  }, COMPANION_POLL_MS);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { clearInterval(statusTimer); void proof.close().then(() => process.exit(0)); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
