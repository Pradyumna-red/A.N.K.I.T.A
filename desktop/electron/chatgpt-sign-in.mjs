import { randomUUID } from 'node:crypto';
import { signInCookies, SIGN_IN_ERRORS, SESSION_COOKIE_PATTERN, COOKIE_EXPIRATION_UNIT_MS, SESSION_COOKIE_PATH } from '../chatgpt-companion/sign-in.mjs';
import { CHATGPT_ORIGIN } from '../../services/chatgpt-bridge/config.mjs';

const OFFER_TTL_MS = 15 * 60_000; // Milliseconds: explicit, process-local transfer offer; no durable cookie payload or capability.
export async function importSessionCookies(session, raw, current, ownsSession = () => true) {
  const cookies = signInCookies(raw), url = CHATGPT_ORIGIN + SESSION_COOKIE_PATH;
  const check = () => { if (!current()) throw Error(SIGN_IN_ERRORS.expired); };
  check();
  const previous = (await session.cookies.get({ url })).filter(cookie => SESSION_COOKIE_PATTERN.test(cookie.name));
  check();
  if (previous.some(cookie => cookie.expirationDate === undefined || cookie.expirationDate * COOKIE_EXPIRATION_UNIT_MS > Date.now())) throw Error(SIGN_IN_ERRORS.busy);
  const set = cookie => session.cookies.set({ url, name: cookie.name, value: cookie.value, path: cookie.path,
    ...(!cookie.hostOnly ? { domain: cookie.domain } : {}), secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite,
    ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {}) });
  const rollback = async () => {
    if (!ownsSession()) return;
    try {
      const saved = await session.cookies.get({ url });
      for (const cookie of saved.filter(row => SESSION_COOKIE_PATTERN.test(row.name))) { if (!ownsSession()) break; await session.cookies.remove(url, cookie.name); }
      for (const cookie of previous) { if (!ownsSession()) break; await set(cookie); }
      if (ownsSession()) await session.cookies.flushStore();
    } catch { throw Error(SIGN_IN_ERRORS.failed); }
  };
  try {
    for (const cookie of previous) { check(); await session.cookies.remove(url, cookie.name); }
    for (const cookie of cookies) { check(); await set(cookie); }
    await session.cookies.flushStore(); check();
    const saved = await session.cookies.get({ url }); check();
    if (cookies.some(cookie => !saved.some(row => row.name === cookie.name && row.value === cookie.value))) throw Error(SIGN_IN_ERRORS.failed);
    return { rollback }; // Custody continues through the caller's final synchronous handoff commit.
  } catch {
    try { await rollback(); } catch { /* Fixed failure only, including an unconfirmed rollback. */ }
    throw Error(SIGN_IN_ERRORS.failed);
  }
}
export class SignInTransfer {
  begin(current, write) {
    if (this.writing) throw Error(SIGN_IN_ERRORS.busy);
    if (!current()) throw Error(SIGN_IN_ERRORS.expired);
    this.active = { id: randomUUID(), expiresAt: Date.now() + OFFER_TTL_MS, current, write }; this.receipt = null;
    return this.pending();
  }
  pending() {
    const active = this.active;
    return active && active.current() && Date.now() < active.expiresAt ? { id: active.id, expiresAt: active.expiresAt } : null;
  }
  cancel() { this.active = null; this.receipt = null; }
  async accept(id, browserId, raw, ingressCurrent = () => true) {
    if (!ingressCurrent()) throw Error(SIGN_IN_ERRORS.expired);
    if (this.receipt?.id === id && this.receipt.browserId === browserId) return;
    const active = this.active;
    if (!active || active.id !== id || !this.pending()) throw Error(SIGN_IN_ERRORS.expired);
    if (this.writing) throw Error(SIGN_IN_ERRORS.busy);
    const cookies = signInCookies(raw);
    const current = () => this.active === active && active.current() && ingressCurrent() && Date.now() < active.expiresAt;
    this.writing = true;
    let transaction;
    try {
      transaction = await active.write(cookies, current);
      if (!current()) { await transaction?.rollback?.(); transaction = null; throw Error(SIGN_IN_ERRORS.expired); }
      this.receipt = { id, browserId }; this.active = null;
      try { transaction?.commit?.(); } catch { /* Browser navigation cannot undo an already committed cookie handoff. */ }
    } catch (error) {
      try { await transaction?.rollback?.(); } catch { /* Do not expose cookie API errors. */ }
      throw Error(Object.values(SIGN_IN_ERRORS).includes(error.message) ? error.message : SIGN_IN_ERRORS.failed);
    }
    finally { this.writing = false; }
  }
}
