export type BrowserBinding = { leaseId: string; browserId: string; tabId: number; conversationId: string; threadId: string; workspacePath: string; epoch: string };
export type OperationOutcome = 'queued' | 'claimed' | 'dispatched' | 'accepted' | 'completed' | 'stopped' | 'rejected' | 'uncertain';
export type BrowserOperation = { id: string; binding: BrowserBinding; kind: 'send' | 'stop' | 'models'; text?: string; modelId?: string; outcome: OperationOutcome };
export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type ToolResult = { content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError: boolean; structuredContent?: Record<string, unknown> };
