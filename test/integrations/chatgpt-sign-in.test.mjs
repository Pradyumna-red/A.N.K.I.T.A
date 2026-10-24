import test from 'node:test';
import assert from 'node:assert/strict';

const sample = (name = '__Secure-next-auth.session-token') => ({ name, value: 'fixture-session-only', domain: '.chatgpt.com', path: '/', secure: true,
  httpOnly: true, hostOnly: false, sameSite: 'lax', expirationDate: Date.now() / 1000 + 60 });
test('sign-in transfer accepts only a complete ChatGPT session, without unrelated cookies or mixed chunks', async () => {
  const module = await import('../../desktop/chatgpt-companion/sign-in.mjs').catch(() => ({}));
  assert.equal(typeof module.signInCookies, 'function');
  assert.equal(module.signInCookies([sample()]).length, 1);
  assert.deepEqual(module.signInCookies([sample('__Secure-next-auth.session-token.1'), sample('__Secure-next-auth.session-token.0')]).map(row => row.name),
    ['__Secure-next-auth.session-token.0', '__Secure-next-auth.session-token.1']);
  for (const batch of [[], [sample('other-cookie')], [sample(), sample('__Secure-next-auth.session-token.0')], [sample('__Secure-next-auth.session-token.1')],
    [{ ...sample(), domain: '.example.com' }], [{ ...sample(), secure: false }], [{ ...sample(), httpOnly: false }], [{ ...sample(), partitionKey: {} }],
    [{ ...sample(), expirationDate: 1 }], [{ ...sample(), value: 'x'.repeat(4097) }]]) assert.throws(() => module.signInCookies(batch), /invalid_session/);
});
test('one explicit sign-in offer expires, cannot be replayed by another browser, and cancels an in-flight write', async () => {
  const module = await import('../../desktop/electron/chatgpt-sign-in.mjs').catch(() => ({}));
  assert.equal(typeof module.SignInTransfer, 'function');
  let current = true, writes = 0;
  const transfer = new module.SignInTransfer();
  const offer = transfer.begin(() => current, async () => { writes++; });
  await transfer.accept(offer.id, 'profile', [sample()]);
  await transfer.accept(offer.id, 'profile', [sample()]); assert.equal(writes, 1);
  await assert.rejects(transfer.accept(offer.id, 'other-profile', [sample()]), /transfer_expired/);
  let entered, release; const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const next = transfer.begin(() => current, async (_cookies, owns) => { entered(); await gate; if (!owns()) throw Error('fixture secret must not escape'); });
  const pending = transfer.accept(next.id, 'profile', [sample()]); void pending.catch(() => {});
  await reached; transfer.cancel(); release();
  await assert.rejects(pending, /^Error: transfer_failed$/);
  current = false; assert.throws(() => transfer.begin(() => current, async () => {}), /transfer_expired/);
});

test('a failed chunk import rolls back and cannot replace an existing active sign-in', async () => {
  const { importSessionCookies } = await import('../../desktop/electron/chatgpt-sign-in.mjs');
  assert.equal(typeof importSessionCookies, 'function');
  let jar = [], writes = 0;
  const session = { cookies: { get: async () => jar.map(row => ({ ...row })), remove: async (_url, name) => { jar = jar.filter(row => row.name !== name); },
    set: async cookie => { if (++writes === 2) throw Error('fixture-secret-cookie-value'); jar.push(cookie); }, flushStore: async () => {} } };
  await assert.rejects(importSessionCookies(session, [sample('__Secure-next-auth.session-token.0'), sample('__Secure-next-auth.session-token.1')], () => true), /^Error: transfer_failed$/);
  assert.deepEqual(jar, []);
  jar = [sample()]; writes = 0;
  await assert.rejects(importSessionCookies(session, [sample()], () => true), /transfer_busy/);
  assert.equal(writes, 0, 'another account in the built-in browser must not be overwritten');
});

test('Chrome transfer reads only the chosen regular ChatGPT cookie store and refuses navigation or partitions', async () => {
  const { readChromeSignIn } = await import('../../desktop/chatgpt-companion/sign-in.mjs');
  let tab = { id: 7, url: 'https://chatgpt.com/c/fixture', incognito: false }, source = [sample(), sample('unrelated-cookie')], calls = 0;
  const api = { permissions: { contains: async () => true }, tabs: { get: async () => { calls++; return tab; } }, cookies: {
    getAllCookieStores: async () => [{ id: 'chosen', tabIds: [7] }, { id: 'other', tabIds: [8] }],
    getAll: async input => { assert.equal(input.storeId, 'chosen'); return source; },
  } };
  assert.equal((await readChromeSignIn(api, 7, 'https://chatgpt.com')).length, 1); assert.equal(calls, 2);
  source = [{ ...sample(), partitionKey: { topLevelSite: 'https://chatgpt.com' } }];
  await assert.rejects(readChromeSignIn(api, 7, 'https://chatgpt.com'), /invalid_session/);
  tab = { ...tab, incognito: true }; await assert.rejects(readChromeSignIn(api, 7, 'https://chatgpt.com'), /chatgpt_tab_required/);
});

test('cancellation after the jar write keeps rollback custody until the handoff commit', async () => {
  const { SignInTransfer } = await import('../../desktop/electron/chatgpt-sign-in.mjs');
  let installed = false, entered, release;
  const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const transfer = new SignInTransfer();
  const offer = transfer.begin(() => true, async () => { installed = true; entered(); await gate; return { rollback: async () => { installed = false; } }; });
  const pending = transfer.accept(offer.id, 'profile', [sample()]); void pending.catch(() => {});
  await reached; transfer.cancel(); release();
  await assert.rejects(pending, /transfer_expired/); assert.equal(installed, false, 'failure cannot leave the imported credential installed');
});
