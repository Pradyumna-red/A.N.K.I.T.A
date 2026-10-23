import { COMMANDS, DESKTOP_ACTIONS, search } from '../../src/palette/index.mjs';

// UI vocabulary and routing IDs live here so the composer and its menu agree.
export const SLASH_TRIGGER = '/';
export const SLASH_STAGES = Object.freeze({ commands: DESKTOP_ACTIONS.commands, model: 'model', project: 'project', skill: 'skill' });
export const SLASH_PALETTE_QUERY = 'palette:query';
export const SLASH_GROUPS = Object.freeze({ quick: 'Quick actions', chat: 'Conversation', workspace: 'Workspace', apps: 'Apps & settings', skills: 'Skills' });
export const SLASH_STAGE_LABELS = Object.freeze({ commands: 'Commands', model: 'Choose a model', project: 'Choose a project', skill: 'Choose a skill' });

// Display copy is intentional. Only actions with an existing desktop handler are offered.
const DESKTOP_COMMANDS = [
  { slash: '/model', title: 'Switch model', description: 'Find the right model for this conversation.', group: SLASH_GROUPS.chat, icon: 'sparkle', kind: 'choose', value: SLASH_STAGES.model, hint: 'Search available models, then choose one. Your conversation stays here.', aliases: ['models'] },
  { slash: '/project', title: 'Choose project', description: 'Give this teammate the right workspace and context.', group: SLASH_GROUPS.workspace, icon: 'folder', kind: 'choose', value: SLASH_STAGES.project, hint: 'Choose an active project or work without one. Files and context follow your selection.' },
  { slash: '/skill', title: 'Use a skill', description: 'Start with instructions from an installed skill.', group: SLASH_GROUPS.skills, icon: 'code', kind: 'choose', value: SLASH_STAGES.skill, hint: 'Choose a skill, then describe your task. Nothing sends until you are ready.' },
  { slash: '/schedule', command: DESKTOP_ACTIONS.jobs, icon: 'clock', group: SLASH_GROUPS.workspace, aliases: ['routines', 'reminder'], hint: 'See upcoming tasks, inspect their results, or prepare a new scheduled request.' },
  { slash: '/review', title: 'Review work', description: 'Inspect changed files, artifacts and command output.', command: DESKTOP_ACTIONS.review, icon: 'panel', group: SLASH_GROUPS.workspace, hint: 'Open work review beside this conversation.' },
  { slash: '/projects', title: 'Manage projects', description: 'Browse project tasks, notes and decisions.', command: DESKTOP_ACTIONS.projects, icon: 'folder', group: SLASH_GROUPS.workspace, hint: 'Open your projects. Your current conversation draft is kept.' },
  { slash: '/new', command: DESKTOP_ACTIONS.newTeammate, icon: 'plus', group: SLASH_GROUPS.chat, aliases: ['new-chat', 'teammate'], hint: 'Create a teammate with their own name, instructions and conversation.' },
  { slash: '/export', command: DESKTOP_ACTIONS.export, icon: 'file', group: SLASH_GROUPS.chat, aliases: ['save', 'download'], hint: 'Choose where to save a protected Markdown transcript of this conversation.' },
  { slash: '/clear', title: 'Clear conversation', description: 'Start fresh with this teammate.', command: DESKTOP_ACTIONS.clear, icon: 'refresh', group: SLASH_GROUPS.chat, hint: 'You will be asked to confirm before this conversation is cleared.', confirm: true },
  { slash: '/plugins', command: DESKTOP_ACTIONS.plugins, icon: 'plug', group: SLASH_GROUPS.apps, hint: 'Manage connected apps, installed skills and their access.' },
  { slash: '/browser', title: 'Browser connections', description: 'Set up the isolated browser or connect Chrome.', command: DESKTOP_ACTIONS.browser, icon: 'browser', group: SLASH_GROUPS.apps, hint: 'Open browser settings to inspect your available connections.' },
  { slash: '/skills', title: 'Manage skills', description: 'Browse and enable your installed instructions.', command: DESKTOP_ACTIONS.skills, icon: 'code', group: SLASH_GROUPS.apps, hint: 'Open the skills section. Use /skill to prepare a request with one.' },
  { slash: '/settings', command: DESKTOP_ACTIONS.settings, icon: 'settings', group: SLASH_GROUPS.apps, aliases: ['config', 'preferences'], hint: 'Open model settings, providers, appearance and preferences.' },
  { slash: '/updates', command: DESKTOP_ACTIONS.updates, icon: 'refresh', group: SLASH_GROUPS.apps, hint: 'Check whether an ANKITA update is available.' },
  { slash: '/commands', title: 'Browse all commands', description: 'Find an action without remembering its name.', command: DESKTOP_ACTIONS.commands, icon: 'search', group: SLASH_GROUPS.apps, aliases: ['help'], hint: 'Type a name or what you want to do. Use the arrow keys or click a result.' },
];

export function commandEntries() {
  const groups = Object.values(SLASH_GROUPS);
  return DESKTOP_COMMANDS.map(entry => {
    const existing = COMMANDS.find(command => command.command === entry.command);
    return { ...entry, group: entry.kind === 'choose' ? SLASH_GROUPS.quick : entry.group, id: entry.slash, kind: entry.kind || 'action', title: entry.title || existing?.title || entry.slash, description: entry.description || existing?.hint || '', keywords: existing?.keywords || [] };
  }).sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group));
}

export function slashQuery(text) {
  if (!text.startsWith(SLASH_TRIGGER) || /[\r\n]/.test(text) || text.slice(SLASH_TRIGGER.length).includes(SLASH_TRIGGER)) return null;
  const query = text.slice(SLASH_TRIGGER.length);
  const [name] = query.toLowerCase().split(/\s/);
  if (Object.values(SLASH_STAGES).includes(name) && name !== SLASH_STAGES.commands && /\s/.test(query)) return { stage: name, query: query.slice(name.length).trimStart() };
  return { stage: SLASH_STAGES.commands, query };
}

export function searchSlashEntries(entries, input = '') {
  if (!input.trim()) return entries;
  const originals = new Map(entries.map(entry => [entry.id, entry]));
  return search(entries.map(entry => ({ ...entry, title: entry.slash || entry.title, keywords: [entry.title, entry.description, ...(entry.keywords || []), ...(entry.aliases || [])].filter(Boolean) })), input).map(entry => originals.get(entry.id));
}

export function modelEntries(models, activeModel) {
  return models.map(model => ({ id: `model:${model.id}`, kind: 'model', value: model.id, title: model.name || model.id, description: [model.vendor, model.id, model.tools === false ? 'Text only' : ''].filter(Boolean).join(' · '), group: 'Available models', icon: 'sparkle', active: model.id === activeModel, keywords: [model.vendor || '', model.id], hint: 'Use this model for this teammate. Your conversation is preserved.' }));
}

export function projectEntries(projects, activeProject) {
  return [{ id: 'project:none', kind: 'project', value: null, title: 'No project', description: 'Work without a project assignment.', group: 'Your projects', icon: 'chat', active: !activeProject, hint: 'Remove the project assignment from this teammate.' }, ...projects.filter(project => !project.archived).map(project => ({ id: `project:${project.id}`, kind: 'project', value: project.id, title: project.name, description: project.path || project.summary || 'Project context', group: 'Your projects', icon: 'folder', active: project.id === activeProject, hint: 'Use this project’s folder, working rules and shared context.' }))];
}

export function skillEntries(entries) {
  return entries.filter(entry => entry.source === 'skill' && entry.skill).map(entry => ({ id: entry.id, kind: 'draft', value: entry.skill, slash: `/skill ${entry.skill}`, title: entry.title, description: entry.hint || '', group: SLASH_GROUPS.skills, icon: 'code', hint: 'Prepare an editable request with this skill. Add your task before sending.', keywords: entry.keywords || [] }));
}

export function skillDraft(entry) {
  return `Use the ${entry.value} skill. ${entry.title === entry.value ? '' : `${entry.title.replace(/[.!?]+$/, '')}. `}`;
}

export function moveSlashSelection(current, direction, count) {
  return count ? (current + direction + count) % count : 0;
}
