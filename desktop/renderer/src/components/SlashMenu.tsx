import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Model, Project } from '../../../shared/wire';
import type { PaletteEntry } from '../../../../src/palette/index.mjs';
import { commandEntries, modelEntries, projectEntries, skillEntries, skillDraft, slashQuery, searchSlashEntries, moveSlashSelection, SLASH_TRIGGER, SLASH_STAGES, SLASH_STAGE_LABELS, SLASH_PALETTE_QUERY } from '../../../shared/slash-commands.mjs';
import type { SlashEntry } from '../../../shared/slash-commands.mjs';
import { CHATGPT_BROWSER_PROVIDER } from '../../../shared/chatgpt-browser.mjs';
import { Icon } from './Icons';
import './slash-menu.css';

const MENU_VIEWPORT_GAP_PX = 12; // CSS pixels; the panel gap plus breathing room at the viewport top.
const IME_PROCESS_KEY_CODE = 229; // DOM legacy key code; composition Enter must not fall through to chat submission.

export function useSlashCommands({ text, setText, threadId, revision, models, model, provider, projects, projectId, onModel, onProject, onCommand, focus }: {
  text: string; setText: (value: string) => void; threadId: string; revision: number; models: Model[]; model: string; provider?: string; projects: Project[]; projectId: string | null;
  onModel: (id: string) => void; onProject: (id: string | null) => void; onCommand: (command: string) => void; focus: () => void;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [reload, setReload] = useState(0);
  const [skills, setSkills] = useState<PaletteEntry[]>([]);
  const [loadedCatalog, setLoadedCatalog] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const suspendedDraft = useRef<{ threadId: string; text: string } | null>(null);
  const request = slashQuery(text);
  const open = Boolean(request && dismissed !== `${threadId}:${text}`);
  const stage = request?.stage || SLASH_STAGES.commands;
  const query = request?.query || '';
  const catalogKey = `${threadId}:${revision}:${reload}`;
  const browserModel = provider === CHATGPT_BROWSER_PROVIDER;
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => { setSelected(0); setDismissed(value => value && value !== `${threadId}:${text}` ? null : value); }, [text, threadId]);
  useEffect(() => { if (!slashQuery(text) && suspendedDraft.current?.threadId === threadId) suspendedDraft.current = null; }, [text, threadId]);
  useEffect(() => () => {
    // A toolbar-opened menu temporarily occupies the input. Restore its draft
    // when navigating away, including when switching teammates.
    if (suspendedDraft.current?.threadId === threadId) { const prior = suspendedDraft.current.text; suspendedDraft.current = null; setText(prior); }
  }, [threadId]);
  useLayoutEffect(() => {
    if (!open || !shell.current) return;
    const element = shell.current;
    const measure = () => {
      const pane = element.closest('.chat-pane');
      const top = pane?.querySelector('.chat-context-bar')?.getBoundingClientRect().bottom ?? pane?.getBoundingClientRect().top ?? 0;
      element.style.setProperty('--slash-available-height', `${Math.max(0, element.getBoundingClientRect().top - top - MENU_VIEWPORT_GAP_PX)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(''); setSkills([]);
    void window.ankita.invoke<PaletteEntry[]>(SLASH_PALETTE_QUERY, { query: '' }).then(entries => {
      if (active) { setSkills(Array.isArray(entries) ? entries : []); setLoadedCatalog(catalogKey); }
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, threadId, revision, reload]);
  const takeDraft = () => {
    const prior = suspendedDraft.current?.threadId === threadId ? suspendedDraft.current.text : '';
    suspendedDraft.current = null;
    return prior;
  };
  const dismiss = () => { setDismissed(`${threadId}:${text}`); if (suspendedDraft.current?.threadId === threadId) setText(takeDraft()); focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (shell.current && !shell.current.contains(event.target as Node)) dismiss(); };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open, text, threadId]);

  const entries = useMemo(() => {
    const installed = loading || error || loadedCatalog !== catalogKey ? [] : skillEntries(skills);
    const available = stage === SLASH_STAGES.model ? (browserModel ? [] : modelEntries(models, model))
      : stage === SLASH_STAGES.project ? projectEntries(projects, projectId)
        : stage === SLASH_STAGES.skill ? installed : [...commandEntries(), ...installed];
    return searchSlashEntries(available, query);
  }, [stage, query, skills, models, model, projects, projectId, browserModel, loading, error, loadedCatalog, catalogKey]);
  const index = Math.min(selected, Math.max(0, entries.length - 1));
  const active = entries[index];
  const choose = (entry = active) => {
    if (!entry) return;
    if (entry.kind === 'choose') { setDismissed(null); setText(`${SLASH_TRIGGER}${entry.value} `); focus(); return; }
    if (entry.command === SLASH_STAGES.commands) { setDismissed(null); setText(SLASH_TRIGGER); focus(); return; }
    if (entry.kind === 'draft') { setText(skillDraft(entry) + takeDraft()); focus(); return; }
    // Clear only the command text; attachments remain with their teammate.
    setText(takeDraft()); setDismissed(null); focus();
    if (entry.kind === 'model' && entry.value) onModel(entry.value);
    else if (entry.kind === 'project') onProject(entry.value ?? null);
    else if (entry.command) onCommand(entry.command);
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return false;
    if (event.nativeEvent.isComposing || event.keyCode === IME_PROCESS_KEY_CODE) return true;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return true; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(moveSlashSelection(index, event.key === 'ArrowDown' ? 1 : -1, entries.length)); return true; }
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); setSelected(event.key === 'Home' ? 0 : Math.max(0, entries.length - 1)); return true; }
    if (event.key === 'Backspace' && stage !== SLASH_STAGES.commands && !query) { event.preventDefault(); setText(SLASH_TRIGGER); return true; }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); choose(); return true; }
    return false;
  };
  const browse = () => { if (text && !request) suspendedDraft.current = { threadId, text }; setDismissed(null); setText(SLASH_TRIGGER); focus(); };
  return { open, stage, query, entries, index, active, choose, keyDown, browse, dismiss, shell, loading, error, browserModel, highlight: setSelected, retry: () => setReload(value => value + 1), back: browse };
}

export function SlashMenu({ menu, id }: { menu: ReturnType<typeof useSlashCommands>; id: string }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' }); }, [menu.index, menu.query]);
  const scoped = menu.stage !== SLASH_STAGES.commands;
  const verb = (entry: SlashEntry) => entry.active ? 'Current' : entry.kind === 'choose' ? 'Choose' : entry.kind === 'draft' ? 'Prepare' : entry.confirm ? 'Confirm' : entry.kind === 'model' || entry.kind === 'project' ? 'Select' : 'Open';
  return <section className="slash-menu" aria-label="Command suggestions">
    <header className="slash-menu-header">
      {scoped ? <button type="button" className="slash-back" onClick={menu.back} aria-label="Back to all commands"><Icon name="arrowRight" size={15} /></button> : <span className="slash-mark" aria-hidden="true">/</span>}
      <div><strong>{SLASH_STAGE_LABELS[menu.stage]}</strong><span>{scoped ? 'Type to narrow your choices' : 'Find an action. Keep your flow.'}</span></div>
      <span className="slash-result-count" aria-live="polite">{menu.entries.length} {menu.entries.length === 1 ? 'result' : 'results'}</span>
      <button type="button" className="slash-dismiss" onClick={menu.dismiss} aria-label="Close commands"><Icon name="close" size={15} /></button>
    </header>
    <div className="slash-menu-body">
      <div className="slash-list" id={id} ref={list} role="listbox" aria-label="Commands" aria-busy={menu.loading && menu.stage === SLASH_STAGES.skill}>
        {menu.entries.map((entry, index) => <div className="slash-result" key={entry.id}>
          {(!menu.query && (index === 0 || menu.entries[index - 1].group !== entry.group)) && <div className="slash-group" role="presentation">{entry.group}</div>}
          <button type="button" id={`${id}-${index}`} role="option" aria-selected={menu.index === index} tabIndex={-1} className={`slash-option ${menu.index === index ? 'selected' : ''}`} onPointerMove={() => menu.index !== index && menu.highlight(index)} onClick={() => menu.choose(entry)}>
            <span className="slash-option-icon"><Icon name={entry.icon} size={17} /></span>
            <span className="slash-option-copy"><span className="slash-option-title">{entry.slash && <strong>{entry.slash}</strong>}<span>{entry.title}</span></span><small>{entry.description}</small></span>
            {entry.active ? <Icon name="check" size={15} /> : <span className="slash-option-go" aria-hidden="true"><Icon name={entry.kind === 'choose' ? 'chevron' : 'arrowRight'} size={14} /></span>}
          </button>
        </div>)}
        {!menu.entries.length && <div className="slash-empty"><Icon name={menu.loading ? 'clock' : 'search'} size={23} /><strong>{menu.loading && menu.stage === SLASH_STAGES.skill ? 'Loading your skills…' : menu.stage === SLASH_STAGES.model && menu.browserModel ? 'Your ChatGPT chat chooses the model' : 'No matches yet'}</strong><p>{menu.stage === SLASH_STAGES.model && menu.browserModel ? 'Change the model in your selected ChatGPT conversation. ANKITA follows that chat’s model.' : menu.query ? 'Try another name or a few words about the action.' : menu.stage === SLASH_STAGES.model ? 'Models come from your provider. Check your connection in Settings.' : 'Your installed skills will appear here.'}</p></div>}
      </div>
      {menu.active && <aside className="slash-preview" aria-label="Selected command details"><span className="slash-preview-icon"><Icon name={menu.active.icon} size={23} /></span><span className="slash-preview-group">{menu.active.group}</span><h3>{menu.active.title}</h3><p>{menu.active.hint || menu.active.description}</p><span className={`slash-outcome ${menu.active.confirm ? 'caution' : ''}`}><Icon name={menu.active.confirm ? 'alert' : menu.active.kind === 'draft' ? 'edit' : 'check'} size={14} />{menu.active.confirm ? 'Asks before clearing' : menu.active.kind === 'draft' ? 'Draft first. You send it.' : 'Stays in your workspace'}</span><span className="slash-preview-action"><kbd>↵</kbd>{verb(menu.active)}</span></aside>}
    </div>
    {(menu.loading || menu.error) && <div className={`slash-load-status ${menu.error ? 'failed' : ''}`} role="status">{menu.error ? <><Icon name="alert" size={14} /><span>Skills could not load. Your commands still work.</span><button type="button" onClick={menu.retry} title={menu.error}>Retry</button></> : <><Icon name="refresh" size={13} /><span>Loading installed skills…</span></>}</div>}
    <footer className="slash-menu-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Choose <kbd>tab</kbd> Complete</span><span><kbd>esc</kbd> Close</span></footer>
  </section>;
}
