import { createHash } from 'node:crypto';
import { NATIVE_TOOL_SURFACES } from './protocol.mjs';
import { APP_MENTION_PATH_PATTERN, APP_NAME_MAX_CHARS } from './app-mentions.mjs';

export const MAX_CONNECTOR_SCOPES = 500; // Confirmed conversation/profile/workspace scopes; refuse cache growth instead of evicting execution journals.
const cleanName = value => typeof value === 'string' && value.trim() && value.length <= APP_NAME_MAX_CHARS && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
export const connectorScope = binding => binding?.conversationId ? createHash('sha256').update(JSON.stringify([
  binding.browserId, binding.threadId, binding.workspacePath, binding.conversationId,
])).digest('hex') : null; // No cache crosses another browser profile, teammate, workspace or unconfirmed chat.
/** CoS connector-identity.ts principle: a page sighting learns nothing until our own receipt proves the request. */
export function provenConnectorApps(sightings = [], receipts = []) {
  const candidates = new Map(), surfaces = new Map();
  for (const item of sightings) {
    const path = `app://${item?.appId}`, name = cleanName(item?.appName);
    if (!APP_MENTION_PATH_PATTERN.test(path) || !name || typeof item.requestId !== 'string') continue;
    const key = JSON.stringify([item.requestId, item.toolName ?? null]);
    const prior = candidates.get(key);
    candidates.set(key, prior === undefined || prior?.path === path ? { ...item, name, path } : null);
  }
  for (const candidate of candidates.values()) {
    if (!candidate) continue;
    const proved = new Set(receipts.filter(row => row.phase === 'settled' && row.owner?.requestId === candidate.requestId &&
      (!candidate.toolName || row.owner.name === candidate.toolName)).map(row => row.owner.surface));
    if (proved.size !== 1) continue;
    const surface = [...proved][0];
    if (!Object.values(NATIVE_TOOL_SURFACES).includes(surface)) continue;
    const prior = surfaces.get(surface);
    surfaces.set(surface, prior === undefined || prior?.path === candidate.path ? { surface, name: candidate.name, path: candidate.path } : null);
  }
  return [...surfaces.values()].filter(Boolean);
}
