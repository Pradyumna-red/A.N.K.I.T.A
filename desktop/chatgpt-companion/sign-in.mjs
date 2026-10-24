// Focused MIT CoS sign-in-transfer.ts/background.js adaptation at a9c02cc8.
export const SESSION_COOKIE_NAME = '__Secure-next-auth.session-token'; // ChatGPT's HttpOnly session cookie; chunk suffixes are part of the same credential.
export const SESSION_COOKIE_PATTERN = /^__Secure-next-auth\.session-token(?:\.\d+)?$/;
export const SIGN_IN_COOKIE_PERMISSION = 'cookies'; // Optional Chrome permission, requested only by the popup's explicit transfer click.
export const MAX_SESSION_COOKIES = 16; // Complete contiguous token chunks, matching the reviewed upstream bound.
export const COOKIE_EXPIRATION_UNIT_MS = 1000; // Milliseconds per Chrome/Electron expiration timestamp second.
export const SESSION_COOKIE_PATH = '/'; // Only the origin-wide ChatGPT session credential is eligible for handoff.
const SESSION_COOKIE_HOST = 'chatgpt.com'; // Exact upstream credential host; sibling domains cannot supply a sign-in.
const SESSION_COOKIE_DOMAINS = new Set([SESSION_COOKIE_HOST, '.' + SESSION_COOKIE_HOST]);
const MAX_COOKIE_CHARS = 4096; // Characters per session-cookie value; never copied to app settings or logs.
const COOKIE_FIELDS = new Set(['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'hostOnly', 'sameSite', 'expirationDate']);
const SAME_SITES = new Set(['no_restriction', 'lax', 'strict', 'unspecified']);
export const SIGN_IN_ERRORS = Object.freeze({ invalid: 'invalid_session', expired: 'transfer_expired', busy: 'transfer_busy', failed: 'transfer_failed',
  permission: 'permission_denied', tab: 'chatgpt_tab_required' }); // Fixed reasons only: browser cookie API errors may contain credentials.
const fail = () => { throw new Error(SIGN_IN_ERRORS.invalid); };
export function signInCookies(raw, now = Date.now()) {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_SESSION_COOKIES) fail();
  for (const cookie of raw) if (!cookie || Object.keys(cookie).some(key => !COOKIE_FIELDS.has(key)) ||
    typeof cookie.name !== 'string' || !SESSION_COOKIE_PATTERN.test(cookie.name) || typeof cookie.value !== 'string' || !cookie.value.length || cookie.value.length > MAX_COOKIE_CHARS ||
    !SESSION_COOKIE_DOMAINS.has(cookie.domain) || cookie.path !== SESSION_COOKIE_PATH || cookie.secure !== true || cookie.httpOnly !== true ||
    cookie.hostOnly !== (cookie.domain === SESSION_COOKIE_HOST) || !SAME_SITES.has(cookie.sameSite) ||
    (cookie.expirationDate !== undefined && (!Number.isFinite(cookie.expirationDate) || cookie.expirationDate * COOKIE_EXPIRATION_UNIT_MS <= now))) fail();
  if (raw.some(cookie => cookie.domain !== raw[0].domain || cookie.hostOnly !== raw[0].hostOnly)) fail();
  const sorted = raw.map(cookie => ({ ...cookie })).sort((a, b) => Number(a.name.split('.').at(-1)) - Number(b.name.split('.').at(-1)));
  if (!(sorted.length === 1 && sorted[0].name === SESSION_COOKIE_NAME) && sorted.some((cookie, index) => cookie.name !== `${SESSION_COOKIE_NAME}.${index}`)) fail();
  return sorted;
}
export async function readChromeSignIn(api, tabId, origin) {
  if (!await api.permissions.contains({ permissions: [SIGN_IN_COOKIE_PERMISSION] })) throw Error(SIGN_IN_ERRORS.permission);
  const tab = await api.tabs.get(tabId);
  if (!tab || tab.incognito || tab.pendingUrl || new URL(tab.url).origin !== origin) throw Error(SIGN_IN_ERRORS.tab);
  const stores = (await api.cookies.getAllCookieStores()).filter(store => store.tabIds.includes(tabId));
  if (stores.length !== 1) throw Error(SIGN_IN_ERRORS.tab);
  const source = (await api.cookies.getAll({ url: origin + SESSION_COOKIE_PATH, storeId: stores[0].id })).filter(cookie => SESSION_COOKIE_PATTERN.test(cookie.name));
  if (source.some(cookie => cookie.partitionKey)) fail();
  const latest = await api.tabs.get(tabId);
  if (latest.incognito || latest.pendingUrl || latest.url !== tab.url) throw Error(SIGN_IN_ERRORS.tab);
  return signInCookies(source.map(cookie => Object.fromEntries([...COOKIE_FIELDS].filter(key => cookie[key] !== undefined).map(key => [key, cookie[key]]))));
}
