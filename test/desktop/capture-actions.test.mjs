import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAPTURE_ACTIONS } from '../../desktop/browser-helper/protocol.mjs';
import { runCaptureAction } from '../../desktop/electron/capture-actions.mjs';
import { CompanionCapture } from '../../desktop/electron/companion-capture.mjs';

const CONFLICT = "Error invoking remote method 'engine:invoke': Error: listen EADDRINUSE: address already in use 127.0.0.1:50457";
const failStart = async () => { throw new Error(CONFLICT); };
const noopOpen = () => 'helper opened';

test('a remembered-port conflict becomes an unavailable setup result instead of a rejected engine call', async () => {
  const result = await runCaptureAction({ action: CAPTURE_ACTIONS.setup, payload: {}, surface: 'main', sourceId: 1, start: failStart, openHelper: noopOpen });
  assert.equal(result.unavailable.title, 'Ankita is already running');
  assert.match(result.unavailable.detail, /127\.0\.0\.1:50457/);
  assert.match(result.unavailable.hint, /Close the other Ankita window/);
  assert.doesNotMatch(JSON.stringify(result), /invoking remote method|eaddrinuse/i);
});

test('background polling and drag bookkeeping stay inert when the bridge cannot start', async () => {
  const expected = [[CAPTURE_ACTIONS.inbox, []], [CAPTURE_ACTIONS.register, false], [CAPTURE_ACTIONS.cancel, false], [CAPTURE_ACTIONS.ack, false]];
  for (const [action, value] of expected) {
    const result = await runCaptureAction({ action, payload: {}, surface: 'main', sourceId: 1, start: failStart, openHelper: noopOpen });
    assert.deepEqual(result, value, `${action} must not reject engine:invoke`);
  }
});

test('a successful bridge dispatches each action with the calling window identity', async () => {
  const calls = [];
  const capture = {
    setup: () => ({ address: '127.0.0.1:1', code: 'pair-code', instanceId: 'instance', paired: 1 }),
    register: input => { calls.push(['register', input]); return true; },
    cancel: (ticketId, sourceId) => { calls.push(['cancel', ticketId, sourceId]); return true; },
    inbox: surface => { calls.push(['inbox', surface]); return [{ id: 'capture-1' }]; },
    ack: (id, surface) => { calls.push(['ack', id, surface]); return true; },
  };
  const start = async () => capture;
  assert.equal((await runCaptureAction({ action: CAPTURE_ACTIONS.setup, payload: {}, surface: 'island', sourceId: 7, start, openHelper: noopOpen })).code, 'pair-code');
  assert.equal(await runCaptureAction({ action: CAPTURE_ACTIONS.register, payload: { ticketId: 'ticket', threadId: 'chief' }, surface: 'island', sourceId: 7, start, openHelper: noopOpen }), true);
  assert.equal(await runCaptureAction({ action: CAPTURE_ACTIONS.cancel, payload: { ticketId: 'ticket' }, surface: 'main', sourceId: 7, start, openHelper: noopOpen }), true);
  assert.deepEqual(await runCaptureAction({ action: CAPTURE_ACTIONS.inbox, payload: {}, surface: 'main', sourceId: 7, start, openHelper: noopOpen }), [{ id: 'capture-1' }]);
  assert.equal(await runCaptureAction({ action: CAPTURE_ACTIONS.ack, payload: { id: 'capture-1' }, surface: 'island', sourceId: 7, start, openHelper: noopOpen }), true);
  assert.deepEqual(calls, [
    ['register', { ticketId: 'ticket', threadId: 'chief', surface: 'island', sourceId: 7 }],
    ['cancel', 'ticket', 7],
    ['inbox', 'main'],
    ['ack', 'capture-1', 'island'],
  ]);
});

test('a second real bridge on the remembered port reports human availability instead of rejecting', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ankita-capture-actions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configFile = join(dir, 'bridge.json');
  const first = new CompanionCapture({ configFile, threadExists: () => true, onCapture: () => {} });
  await first.start();
  t.after(() => first.close());
  const second = new CompanionCapture({ configFile, threadExists: () => true, onCapture: () => {} });
  const port = new URL(first.address).port;
  const setup = await runCaptureAction({ action: CAPTURE_ACTIONS.setup, payload: {}, surface: 'main', sourceId: 1, start: () => second.start(), openHelper: noopOpen });
  assert.equal(setup.unavailable.title, 'Ankita is already running');
  assert.match(setup.unavailable.detail, new RegExp(`127\\.0\\.0\\.1:${port}`));
  assert.match(setup.unavailable.hint, /Close the other Ankita window/);
  assert.deepEqual(await runCaptureAction({ action: CAPTURE_ACTIONS.inbox, payload: {}, surface: 'main', sourceId: 1, start: () => second.start(), openHelper: noopOpen }), []);
  await second.close();
});

test('helper-folder opening and unrelated actions never start the capture bridge', async () => {
  let started = 0;
  const start = async () => { started++; return {}; };
  assert.equal(await runCaptureAction({ action: CAPTURE_ACTIONS.openHelper, payload: {}, surface: 'main', sourceId: 1, start, openHelper: () => 'opened' }), 'opened');
  assert.equal(await runCaptureAction({ action: CAPTURE_ACTIONS.openHelper, payload: {}, surface: 'main', sourceId: 1, start, openHelper: async () => { throw new Error('cannot open folder'); } }).then(result => result.unavailable.title), 'Something went wrong');
  assert.equal(await runCaptureAction({ action: 'send', payload: {}, surface: 'main', sourceId: 1, start, openHelper: noopOpen }), false);
  assert.equal(started, 0);
});
