/**
 * Turns IPC and provider failures into short, actionable notice copy.
 *
 * The renderer used to print `err.message` verbatim, which surfaced transport
 * prefixes and port numbers in a red popup over the chat. The original text is
 * kept as `technical` for the disclosure row, never as the headline.
 */

const IPC_PREFIX = /^Error invoking remote method '[^']+':\s*/i;
const ERROR_PREFIX = /^Error:\s*/i;
const LOCAL_ADDRESS = /\b((?:\d{1,3}\.){3}\d{1,3}:\d{1,5})\b/;

/**
 * @typedef {'error' | 'warning'} ErrorNoticeTone
 * @typedef {{ title: string; detail: string; hint?: string; technical?: string; tone: ErrorNoticeTone }} ErrorNotice
 */

/** @param {unknown} raw @returns {string} */
export function cleanErrorMessage(raw) {
  return String(raw ?? '').replace(IPC_PREFIX, '').replace(ERROR_PREFIX, '').trim();
}

/**
 * @param {unknown} raw
 * @returns {ErrorNotice}
 */
export function describeErrorNotice(raw) {
  const technical = String(raw ?? '').trim();
  const message = cleanErrorMessage(technical);
  const lower = message.toLowerCase();
  const address = technical.match(LOCAL_ADDRESS)?.[1];
  const original = technical ? { technical } : {};

  if (!message) {
    return {
      title: 'Something went wrong',
      detail: 'An unexpected error interrupted that action.',
      hint: 'Try again. If it keeps happening, restart Ankita.',
      tone: 'error',
      ...original,
    };
  }

  if (/desktop scheduler owns routines|--takeover|cooperative shutdown/.test(lower)) {
    return {
      title: 'Scheduled work is already running',
      detail: 'Another Ankita process is managing your scheduled jobs.',
      hint: 'Quit the other Ankita window, then try again here.',
      tone: 'warning',
      ...original,
    };
  }

  if (lower.includes('eaddrinuse')) {
    return {
      title: 'Ankita is already running',
      detail: address ? `Another Ankita process is already using this app's local connection (${address}).` : "Another process is already using this app's local connection.",
      hint: 'Close the other Ankita window or stop the older dev server, then try again.',
      tone: 'warning',
      ...original,
    };
  }

  if (lower.includes('econnrefused')) {
    return {
      title: 'The local service is not responding',
      detail: 'Ankita could not reach its background service.',
      hint: 'Restart Ankita. If it keeps happening, check that security software is not blocking localhost.',
      tone: 'error',
      ...original,
    };
  }

  if (/enotfound|eai_again|getaddrinfo|dns/.test(lower)) {
    return {
      title: 'That address could not be reached',
      detail: 'Ankita could not resolve the network address.',
      hint: 'Check the endpoint URL and your internet connection.',
      tone: 'error',
      ...original,
    };
  }

  if (/etimedout|timed out|timeout|econnreset/.test(lower)) {
    return {
      title: 'The request took too long',
      detail: 'The provider did not finish answering in time.',
      hint: 'Try again, or switch to a faster model in the composer.',
      tone: 'error',
      ...original,
    };
  }

  if (/429|rate.?limit|too many requests/.test(lower)) {
    return {
      title: 'The provider is busy',
      detail: 'Too many requests were sent in a short time.',
      hint: 'Wait a moment, then try again.',
      tone: 'warning',
      ...original,
    };
  }

  if (/401|403|unauthorized|invalid[^.\n]*(api.?key|token)|api.?key[^.\n]*(invalid|missing)/.test(lower)) {
    return {
      title: 'The provider rejected the key',
      detail: 'The saved credential was not accepted.',
      hint: 'Open Settings → Providers, then check or replace the key.',
      tone: 'error',
      ...original,
    };
  }

  if (/model[^.\n]*(not found|unavailable|does not exist|unknown)/.test(lower)) {
    return {
      title: 'That model is not available',
      detail: 'The provider no longer offers the selected model.',
      hint: 'Choose another model in Settings → Model.',
      tone: 'error',
      ...original,
    };
  }

  if (/eacces|eperm|permission denied/.test(lower)) {
    return {
      title: 'Ankita could not access that file',
      detail: 'The operating system denied the request.',
      hint: 'Check the file permissions or choose another location.',
      tone: 'error',
      ...original,
    };
  }

  if (/enospc|no space left/.test(lower)) {
    return {
      title: 'This device is out of space',
      detail: 'Ankita could not finish writing its files.',
      hint: 'Free some disk space, then try again.',
      tone: 'error',
      ...original,
    };
  }

  if (/npm run desktop:dev|not connected to the ankita app/.test(lower)) {
    return {
      title: 'Open Ankita in its desktop window',
      detail: 'This view is not connected to the Ankita app.',
      hint: 'Start it with npm run desktop:dev, then use the app window.',
      tone: 'error',
      ...original,
    };
  }

  if (/fetch failed|failed to fetch|network error|networkerror/.test(lower)) {
    return {
      title: 'The network request failed',
      detail: 'Ankita could not complete the connection.',
      hint: 'Check your internet connection, then try again.',
      tone: 'error',
      ...original,
    };
  }

  return {
    title: 'Something went wrong',
    detail: message,
    hint: 'Try again. If it keeps happening, restart Ankita.',
    tone: 'error',
    ...original,
  };
}
