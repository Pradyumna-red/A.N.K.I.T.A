import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanErrorMessage, describeErrorNotice } from '../../desktop/shared/error-notices.mjs';

test('IPC and Error prefixes never reach the human-facing copy', () => {
  const raw = "Error invoking remote method 'engine:invoke': Error: something private broke";
  assert.equal(cleanErrorMessage(raw), 'something private broke');
  const notice = describeErrorNotice(raw);
  assert.equal(notice.title, 'Something went wrong');
  assert.equal(notice.detail, 'something private broke');
  assert.doesNotMatch(notice.detail, /invoking remote method|^Error:/);
  assert.equal(notice.technical, raw);
});

test('a second Ankita process holding the local port is explained, not dumped', () => {
  const raw = "Error invoking remote method 'engine:invoke': Error: listen EADDRINUSE: address already in use 127.0.0.1:50457";
  const notice = describeErrorNotice(raw);
  assert.equal(notice.tone, 'warning');
  assert.equal(notice.title, 'Ankita is already running');
  assert.match(notice.detail, /127\.0\.0\.1:50457/);
  assert.match(notice.hint, /Close the other Ankita window/);
  assert.equal(notice.technical, raw);
});

test('scheduler ownership conflict points at the other process', () => {
  const notice = describeErrorNotice('desktop scheduler owns routines — stop the desktop app or pass --takeover (cooperative shutdown required)');
  assert.equal(notice.tone, 'warning');
  assert.equal(notice.title, 'Scheduled work is already running');
  assert.match(notice.hint, /Quit the other Ankita window/);
});

test('known network, auth, quota, disk and permission failures get actionable copy', () => {
  const cases = [
    ['connect ECONNREFUSED 127.0.0.1:1234', 'The local service is not responding'],
    ['getaddrinfo ENOTFOUND api.example.test', 'That address could not be reached'],
    ['request timed out after 30000ms', 'The request took too long'],
    ['429 Too Many Requests', 'The provider is busy'],
    ['401 Unauthorized: invalid api key', 'The provider rejected the key'],
    ['model gpt-unknown is not available', 'That model is not available'],
    ['EACCES: permission denied', 'Ankita could not access that file'],
    ['ENOSPC: no space left on device', 'This device is out of space'],
    ['fetch failed: network error', 'The network request failed'],
  ];
  for (const [raw, title] of cases) {
    const notice = describeErrorNotice(raw);
    assert.equal(notice.title, title, raw);
    assert.ok(notice.detail.length > 0, raw);
    assert.ok(notice.hint, raw);
    assert.equal(notice.technical, raw);
  }
});

test('empty and unknown failures still produce a safe, dismissible notice', () => {
  for (const raw of [undefined, null, '', '   ']) {
    const notice = describeErrorNotice(raw);
    assert.equal(notice.title, 'Something went wrong');
    assert.equal(notice.tone, 'error');
    assert.ok(notice.hint);
    assert.equal(notice.technical, undefined);
  }
  const unusual = describeErrorNotice({ code: 'weird' });
  assert.equal(unusual.detail, '[object Object]');
  assert.equal(unusual.technical, '[object Object]');
});

test('developer-mode hints only appear for the actual dev entry failure', () => {
  assert.equal(describeErrorNotice('npm run desktop:dev is not connected').title, 'Open Ankita in its desktop window');
  assert.equal(describeErrorNotice('ordinary failure').title, 'Something went wrong');
});
