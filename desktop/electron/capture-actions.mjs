import { CAPTURE_ACTIONS } from '../browser-helper/protocol.mjs';
import { describeErrorNotice } from '../shared/error-notices.mjs';

const CAPTURE_REQUESTS = new Set([CAPTURE_ACTIONS.setup, CAPTURE_ACTIONS.register, CAPTURE_ACTIONS.cancel, CAPTURE_ACTIONS.inbox, CAPTURE_ACTIONS.ack]);

function unavailableFrom(error) {
  const notice = describeErrorNotice(error);
  return { title: notice.title, detail: notice.detail, hint: notice.hint ?? '' };
}

/**
 * Runs one companion-capture IPC action without letting a remembered-port
 * conflict reject the whole engine channel. The renderer gets an actionable
 * availability object for setup and inert values for background polling.
 */
export async function runCaptureAction({ action, payload, surface, sourceId, start, openHelper }) {
  if (!CAPTURE_REQUESTS.has(action)) {
    if (action !== CAPTURE_ACTIONS.openHelper) return false;
    try { return await openHelper(); }
    catch (error) { return { unavailable: unavailableFrom(error) }; }
  }
  try {
    const capture = await start();
    switch (action) {
      case CAPTURE_ACTIONS.setup: return capture.setup();
      case CAPTURE_ACTIONS.register: return capture.register({ ticketId: payload?.ticketId, threadId: payload?.threadId, surface, sourceId });
      case CAPTURE_ACTIONS.cancel: return capture.cancel(payload?.ticketId, sourceId);
      case CAPTURE_ACTIONS.inbox: return capture.inbox(surface);
      case CAPTURE_ACTIONS.ack: return capture.ack(payload?.id, surface);
      default: return false;
    }
  } catch (error) {
    if (action === CAPTURE_ACTIONS.setup) return { unavailable: unavailableFrom(error) };
    return action === CAPTURE_ACTIONS.inbox ? [] : false;
  }
}
