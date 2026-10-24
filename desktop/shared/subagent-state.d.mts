export type SubagentUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  estimated_cost?: number;
};

export type SubagentToolState = 'running' | 'ok' | 'error' | 'stopped';

export type SubagentToolStep = {
  callId: string;
  name: string;
  args?: unknown;
  result?: string;
  isError?: boolean;
  state: SubagentToolState;
};

export type SubagentActivity = {
  subagentId: string;
  parentCallId: string | null;
  subagentType: string;
  description: string;
  prompt: string;
  depth: number;
  status: string;
  text: string;
  tools: SubagentToolStep[];
  summary: string;
  usage: SubagentUsage | null;
  durationMs: number;
  transcript: string | null;
  toolsUsed: string[];
  error: string | null;
  startedAt: number;
  endedAt: number | null;
};

export type SubagentState = Record<string, Record<string, SubagentActivity>>;

export const SUBAGENT_TEXT_LIMIT: number;
export const SUBAGENT_TOOL_LIMIT: number;
export function reduceSubagents(state: SubagentState, event: unknown): SubagentState;
export function clearThreadSubagents(state: SubagentState, threadId: string): SubagentState;
export function activityFromReceipt(result: unknown): SubagentActivity | null;
