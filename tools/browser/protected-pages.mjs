export const PROTECTED_BROWSER_PAGE = 'This model conversation is protected from general browser task tools.'; // Shared task-adapter refusal, never page-authored authority.
export function isProtectedBrowserPage(url, protectedPage) { return typeof protectedPage === 'function' && protectedPage(url) === true; }
export function assertTaskBrowserPage(url, protectedPage) {
  if (isProtectedBrowserPage(url, protectedPage)) throw new Error(PROTECTED_BROWSER_PAGE);
}
