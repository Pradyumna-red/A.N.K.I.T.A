import { NATIVE_TOOL_SURFACES } from './protocol.mjs';

export const APP_NAME_MAX_CHARS = 80; // Characters/display name; matches ChatGPT's native app tag contract.
export const MAX_MENTION_APPS = Object.keys(NATIVE_TOOL_SURFACES).length; // At most one owner-configured app per native surface.
export const APP_MENTION_PATH_PATTERN = /^app:\/\/asdk_app_[A-Za-z0-9_-]{1,160}$/; // ChatGPT-owned app identifiers, from the reviewed CoS tag format.
export const APP_RESOURCE_PATTERN = /^\/(asdk_app_[A-Za-z0-9_-]{1,160})\/(link_[A-Za-z0-9_-]{1,160})\/([^/\s]{1,200})$/; // CoS usage.js appSightingsOf: structured native tool-result resource, never message prose.
export const APP_MENTION_ERRORS = Object.freeze({
  'apps-unobserved': 'Refresh your selected ChatGPT tab once so ANKITA can read its installed app names.',
  'app-not-found': 'An included app was not found in ChatGPT. Match its name in Settings, install it in ChatGPT, or turn off automatic app tags.',
  'app-name-ambiguous': 'ChatGPT has more than one app with the same name. Give the ANKITA app a unique name and update it in Settings.',
  'app-tag-unconfirmed': 'ChatGPT did not accept the app tags. Your message was not confirmed as sent. Check the selected chat before trying again.',
}); // Safe failure labels/messages; arbitrary page text is never persisted as a diagnostic.
export function validateMentionNames(value = []) {
  if (!Array.isArray(value) || value.length > MAX_MENTION_APPS || value.some(name => typeof name !== 'string' || !name.trim() ||
      name.length > APP_NAME_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(name))) throw new Error('Enter a valid ChatGPT app name for each connected tool group');
  return [...new Set(value.map(name => name.trim()))];
}
export function validateAppMentions(value, names) {
  const requested = validateMentionNames(names);
  if (!Array.isArray(value) || value.length !== requested.length || value.some((item, index) => item?.name !== requested[index] || !APP_MENTION_PATH_PATTERN.test(item?.path)) || new Set(value.map(item => item.path)).size !== value.length) throw new Error('ChatGPT app tags do not match the selected apps');
  return value.map(({ name, path }) => ({ name, path }));
}
