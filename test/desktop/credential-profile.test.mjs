import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CREDENTIAL_STORE_FILENAME } from '../../src/integrations/browser-credentials.mjs';

test('desktop credential files follow the encryption profile without overwriting a legacy or existing vault', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-credential-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacyDirectory = path.join(root, 'legacy');
  fs.mkdirSync(legacyDirectory);
  const original = JSON.stringify({ version: 1, records: [{ encrypted: 'fixture-encrypted-record' }] });
  const legacy = path.join(legacyDirectory, CREDENTIAL_STORE_FILENAME);
  fs.writeFileSync(legacy, original);
  const { desktopCredentialFile } = await import('../../desktop/electron/credential-profile.mjs');
  const dev = desktopCredentialFile({ profileDirectory: path.join(root, 'dev'), legacyDirectory });
  const normal = desktopCredentialFile({ profileDirectory: path.join(root, 'normal'), legacyDirectory });
  assert.notEqual(dev, normal);
  assert.equal(fs.readFileSync(dev, 'utf8'), original);
  assert.equal(fs.readFileSync(normal, 'utf8'), original);
  fs.writeFileSync(dev, 'updated-dev-fixture');
  fs.writeFileSync(normal, 'updated-normal-fixture');
  assert.equal(desktopCredentialFile({ profileDirectory: path.dirname(dev), legacyDirectory }), dev);
  assert.equal(fs.readFileSync(dev, 'utf8'), 'updated-dev-fixture');
  assert.equal(fs.readFileSync(normal, 'utf8'), 'updated-normal-fixture');
  assert.equal(fs.readFileSync(legacy, 'utf8'), original);
});

test('a new profile starts with no vault when there is no legacy file', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-credential-profile-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { desktopCredentialFile } = await import('../../desktop/electron/credential-profile.mjs');
  const file = desktopCredentialFile({ profileDirectory: path.join(root, 'profile'), legacyDirectory: path.join(root, 'missing') });
  assert.equal(path.basename(file), CREDENTIAL_STORE_FILENAME);
  assert.equal(fs.existsSync(file), false);
});
