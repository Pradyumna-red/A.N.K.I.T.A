import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icons';

export type Notice = {
  tone: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  hint?: string;
  technical?: string;
};

export function NoticeCard({ notice, onDismiss, dismissLabel = 'Dismiss notice' }: { notice: Notice; onDismiss: () => void; dismissLabel?: string }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  useEffect(() => {
    if (!detailsOpen) return;
    const outside = (event: PointerEvent) => { if (!card.current?.contains(event.target as Node)) setDetailsOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setDetailsOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [detailsOpen]);
  const hasDetails = Boolean(notice.hint || notice.technical);
  return <div ref={card} className={`notice-card ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
    <span className="notice-glyph"><Icon name={notice.tone === 'info' ? 'shield' : 'alert'} size={14} /></span>
    <div className="notice-copy">
      <strong>{notice.title}</strong>
      <p>{notice.detail}</p>
    </div>
    <div className="notice-links">
      {hasDetails && <button type="button" className="notice-more" aria-expanded={detailsOpen} aria-controls={popoverId} onClick={() => setDetailsOpen(open => !open)}>Details</button>}
      <button type="button" className="notice-dismiss" onClick={onDismiss} aria-label={dismissLabel}><Icon name="close" size={13} /></button>
    </div>
    {hasDetails && detailsOpen && <div id={popoverId} className="notice-popover" role="group" aria-label="Notice details">
      {notice.hint ? <p>{notice.hint}</p> : null}
      {notice.technical ? <code>{notice.technical}</code> : null}
    </div>}
  </div>;
}
