import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatgptResourcePaths, verifyCompanionResources } from '../../desktop/electron/chatgpt-resources.mjs';
import { createRequire } from 'node:module';
import publisher from '../../vendor/openai-tunnel/source.json' with { type: 'json' };

test('packaged companion and native helper resolve through real resources outside ASAR and missing extension fails closed', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-package-resources-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const paths = chatgptResourcePaths({ packageRoot: path.join(directory, 'app.asar'), resourcesPath: directory, isPackaged: true });
  assert.equal(paths.companionPath, path.join(directory, 'chatgpt-companion'));
  assert.equal(paths.nativeResourceRoot, path.join(directory, 'native-tunnel'));
  assert.throws(() => verifyCompanionResources(paths.companionPath), /missing/);
  fs.cpSync(fileURLToPath(new URL('../../desktop/chatgpt-companion/', import.meta.url)), paths.companionPath, { recursive: true });
  assert.equal(verifyCompanionResources(paths.companionPath), true);
  fs.unlinkSync(path.join(paths.companionPath, 'upstream', 'delivery.js'));
  assert.throws(() => verifyCompanionResources(paths.companionPath), /missing/);
});

test('Windows packaging keeps publisher helper bytes intact while signing ANKITA itself', () => {
  const text = fs.readFileSync(new URL('../../desktop/packaging/electron-builder.yml', import.meta.url), 'utf8');
  const block = text.match(/  signExts:\n((?:    - [^\n]+\n)+)/)?.[1] ?? '';
  const signExts = [...block.matchAll(/    - '([^']+)'/g)].map(match => match[1]);
  const require = createRequire(import.meta.url);
  require('app-builder-lib'); // The builder's public entry initializes its mutually dependent packager classes.
  const { WinPackager } = require('app-builder-lib/out/winPackager.js');
  const shouldSign = file => WinPackager.prototype.shouldSignFile.call({ platformSpecificBuildOptions: { signExts } }, file);
  for (const target of Object.values(publisher.targets)) {
    assert.equal(shouldSign(target.filename), false, 'The publisher primary hash must survive a signed ANKITA package');
    assert.equal(shouldSign(target.companionFilename), false, 'The publisher forwarding helper hash must survive signing');
  }
  assert.equal(shouldSign('Ankita.exe'), true);
});
