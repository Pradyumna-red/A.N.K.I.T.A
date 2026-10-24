import { useState } from 'react';
import type { SubagentActivity } from '../../../shared/subagent-state.mjs';
import { Icon } from './Icons';
import { formatDuration, formatTokens, humanizeTool, summarizeArgs } from '../lib/format';

const TYPE_LABEL: Record<string, string> = {
  explore: 'Explore agent',
  reviewer: 'Review agent',
  worker: 'Worker agent',
};
const STATUS_LABEL: Record<string, string> = {
  running: 'Working',
  completed: 'Done',
  failed: 'Failed',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
  budget_exceeded: 'Budget reached',
  rejected: 'Not started',
};
const FAILED_STATES = new Set(['failed', 'timeout', 'budget_exceeded', 'rejected']);
const TOOL_STATE_LABEL: Record<string, string> = { running: 'Running', ok: 'Done', error: 'Failed', stopped: 'Stopped' };
const PREVIEW_CHARS = 240; // Characters; enough to see motion in the collapsed card.

function tail(text: string, max: number) {
  const value = text.trim();
  return value.length > max ? `…${value.slice(-max)}` : value;
}

export function SubagentCard({ activity }: { activity: SubagentActivity }) {
  const [open, setOpen] = useState(false);
  const running = activity.status === 'running';
  const failed = FAILED_STATES.has(activity.status);
  const status = STATUS_LABEL[activity.status] || activity.status;
  const tokens = activity.usage ? (activity.usage.prompt_tokens || 0) + (activity.usage.completion_tokens || 0) : 0;
  const report = activity.text.trim();

  return <div className={`subagent-card ${running ? 'running' : ''} ${failed ? 'failed' : ''}`}>
    <button type="button" className="subagent-card-header" onClick={() => setOpen(!open)} aria-expanded={open}>
      <span className="subagent-glyph"><Icon name="cube" size={15} /></span>
      <span className="subagent-title">
        <strong>{TYPE_LABEL[activity.subagentType] || 'Sub-agent'}</strong>
        <span>{activity.description}</span>
      </span>
      <span className="subagent-state">{running && <span className="tool-spinner" />}{status}{activity.durationMs > 0 ? ` · ${formatDuration(activity.durationMs)}` : ''}</span>
      <span className={`tool-card-chevron ${open ? 'open' : ''}`}><Icon name="chevron" size={16} /></span>
    </button>
    {running && activity.text.trim() && !open && <pre className="subagent-preview">{tail(activity.text, PREVIEW_CHARS)}</pre>}
    {open && <div className="subagent-body">
      <div className="subagent-meta">
        <span>Depth {activity.depth}</span>
        {tokens > 0 && <span>{formatTokens(tokens)} tokens</span>}
        {activity.tools.length > 0 && <span>{activity.tools.length} tool {activity.tools.length === 1 ? 'call' : 'calls'}</span>}
      </div>
      {activity.prompt && <section>
        <span className="tool-section-label">Brief</span>
        <pre>{activity.prompt}</pre>
      </section>}
      {report && <section>
        <span className="tool-section-label">{running ? 'Live output' : 'Output'}</span>
        <pre>{report}</pre>
      </section>}
      {activity.summary && (!report || activity.status !== 'completed') && <section>
        <span className="tool-section-label">Summary</span>
        <pre>{activity.summary}</pre>
      </section>}
      {activity.tools.length > 0 && <section>
        <span className="tool-section-label">Tool calls</span>
        <ol className="subagent-tools">
          {activity.tools.map(tool => <li key={tool.callId} className={tool.state}>
            <Icon name={tool.state === 'running' ? 'pulse' : tool.state === 'ok' ? 'check' : 'alert'} size={13} />
            <span>{humanizeTool(tool.name)}</span>
            {summarizeArgs(tool.args) && <small title={summarizeArgs(tool.args)}>{summarizeArgs(tool.args)}</small>}
            <em>{TOOL_STATE_LABEL[tool.state] || tool.state}</em>
          </li>)}
        </ol>
      </section>}
      {activity.error && <p className="subagent-error">{activity.error}</p>}
      {activity.transcript && <p className="subagent-transcript" title={activity.transcript}>Transcript saved: {activity.transcript}</p>}
    </div>}
  </div>;
}
