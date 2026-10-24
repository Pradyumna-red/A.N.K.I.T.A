import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { browserWire as wire } from '../../services/chatgpt-bridge/config.mjs';

// Isolated worker contract fixture: never touches the installed Chrome extension or account.
const source = fs.readFileSync(new URL('../../desktop/chatgpt-companion/background.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') + '\nglobalThis.worker = { ensureTarget, action, automaticallyConnect, tick };';
function worker({ discoverCompanion = async () => null, tabs = [], listed = tabs, lifecycle = false, alarmHooks = {} } = {}) {
  const local = {}, session = {}, calls = [];
  const alarms = new Map(), alarmListeners = [];
  const area = state => ({ get: async key => ({ [key]: state[key] }), set: async value => Object.assign(state, value), remove: async key => { delete state[key]; } });
  const chrome = { runtime: { id: 'a'.repeat(32) }, storage: { local: area(local), session: area(session) }, tabs: { query: async () => tabs, get: async () => tabs[0] } };
  if (lifecycle) {
    chrome.runtime.onMessage = { addListener() {} };
    chrome.alarms = { get: async name => { await alarmHooks.get?.(); return alarms.get(name); }, create: async (name, options) => { await alarmHooks.create?.(); alarms.set(name, options); },
      clear: async name => alarms.delete(name), onAlarm: { addListener: listener => alarmListeners.push(listener) } };
  }
  const context = vm.createContext({ chrome, wire, crypto: { randomUUID: () => 'fixture-browser' }, discoverCompanion, URL, URLSearchParams,
    setTimeout: () => 1, clearTimeout() {}, readSelectedPage() {}, executeBoundSend() {}, executeBoundStop() {},
    fetch: async (url, options) => { calls.push({ url, input: options?.body ? JSON.parse(options.body) : null });
      return { ok: true, json: async () => url.endsWith(wire.routes.tabs) ? listed : {} }; } });
  vm.runInContext(source, context);
  return { api: context.worker, local, session, calls, alarms, alarmListeners };
}
test('MV3 wake alarm survives idle polling, wakes discovery, and respects explicit Disconnect', async () => {
  let discoveries = 0;
  const fixture = worker({ lifecycle: true, discoverCompanion: async () => { discoveries++; return null; } });
  await fixture.api.tick();
  assert.equal(fixture.alarms.size, 1, 'a stopped MV3 worker needs a browser-owned wake event');
  const [name, schedule] = [...fixture.alarms][0];
  assert.ok(schedule.periodInMinutes > 0, 'the alarm persists beyond one worker lifetime');
  await fixture.api.tick();
  assert.equal(fixture.alarms.get(name), schedule, 'fast polling must not keep postponing the wake deadline');
  const before = discoveries;
  fixture.alarmListeners[0]({ name: 'unrelated-alarm' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(discoveries, before);
  fixture.alarmListeners[0]({ name });
  await fixture.api.tick();
  assert.equal(discoveries, before + 1);
  await fixture.api.action({ type: 'disconnect' });
  assert.equal(fixture.alarms.size, 0, 'explicit Disconnect removes the persistent wake');
  fixture.alarmListeners[0]({ name });
  await fixture.api.tick();
  assert.equal(discoveries, before + 1, 'a late alarm must not undo Disconnect');
});
test('Disconnect during alarm lookup or creation cannot leave a late persistent wake', async () => {
  for (const phase of ['get', 'create']) {
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const fixture = worker({ lifecycle: true, alarmHooks: { [phase]: () => { entered(); return blocked; } } });
    const ticking = fixture.api.tick();
    await started;
    await fixture.api.action({ type: 'disconnect' });
    release(); await ticking;
    assert.equal(fixture.alarms.size, 0, phase + ' must not reinstall a wake after Disconnect');
  }
});
test('automatic target binding refuses a tab that navigated from the requested opening to an unrelated chat', async () => {
  const targetUrl = wire.chatgptOrigin + '/#' + wire.openingFragmentKey + '=fixture-opening';
  const fixture = worker({ tabs: [{ id: 7, url: targetUrl }], listed: [{ id: 7, conversationId: crypto.randomUUID(), openingId: null }] });
  await fixture.api.ensureTarget({ browserId: 'fixture-browser', address: 'http://fixture.local', key: 'fixture' }, targetUrl);
  assert.equal(fixture.calls.some(call => call.url.endsWith(wire.routes.bind)), false, 'only the requested opening may bind before its first Send');
});
test('popup Disconnect latches before a late discovery can install its session', async () => {
  let release; const discovered = new Promise(resolve => { release = resolve; });
  const fixture = worker({ discoverCompanion: () => discovered });
  const connecting = fixture.api.automaticallyConnect();
  await new Promise(resolve => setImmediate(resolve));
  const result = await fixture.api.action({ type: 'disconnect' });
  release({ browserId: 'fixture-browser', address: 'http://fixture.local', key: 'fixture' });
  await connecting;
  assert.equal(result.status, 'disconnected');
  assert.equal(Object.values(fixture.local)[0]?.stopped, true);
  assert.equal(Object.keys(fixture.session).length, 0, 'a cancelled discovery may not reinstall credentials');
});
