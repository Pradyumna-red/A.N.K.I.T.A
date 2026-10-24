import type { ReactNode } from 'react';

export type StatusTone = 'live' | 'busy' | 'warn' | 'error' | 'idle';

export function StatusPill({ tone = 'idle', className = '', role, children }: { tone?: StatusTone; className?: string; role?: 'status' | 'alert'; children: ReactNode }) {
  return <span className={`status-pill ${tone}${className ? ` ${className}` : ''}`} role={role}><i aria-hidden="true" />{children}</span>;
}
