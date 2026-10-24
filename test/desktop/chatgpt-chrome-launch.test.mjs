import test from 'node:test';
import assert from 'node:assert/strict';

test('Chrome launch reuses a running browser and only launches a discovered executable after confirmed absence', async () => {
  const module = await import('../../desktop/electron/chatgpt-chrome-launch.mjs').catch(() => ({}));
  assert.equal(typeof module.openChromeIfAbsent, 'function', 'external Chrome must start without requiring an already running window');
  const calls = [];
  const options = { platform: 'win32', env: { LOCALAPPDATA: 'C:\\fixture-local', ProgramFiles: 'C:\\fixture-programs' },
    usable: value => value.startsWith('C:\\fixture-programs'), launch: async (file, args) => { calls.push({ file, args }); } };
  assert.equal(await module.openChromeIfAbsent('https://chatgpt.com/', { ...options, running: async () => true }), false);
  assert.equal(calls.length, 0);
  assert.equal(await module.openChromeIfAbsent('https://chatgpt.com/', { ...options, running: async () => false }), true);
  assert.match(calls[0].file, /Google\\Chrome\\Application\\chrome.exe$/);
  assert.ok(calls[0].args.includes('https://chatgpt.com/'));
  await assert.rejects(module.openChromeIfAbsent('https://chatgpt.com/', { ...options, running: async () => null }), /check|running/i);
  assert.equal(calls.length, 1, 'unknown process state does not authorize another browser launch');
  const control = new AbortController();
  await assert.rejects(module.openChromeIfAbsent('https://chatgpt.com/', { ...options, signal: control.signal,
    running: async () => { control.abort(); return false; } }), /abort/i);
  assert.equal(calls.length, 1, 'Stop during the OS probe cannot launch Chrome afterwards');
});
