import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileDriverExecutable, runDriverBuild } from '../../scripts/lib/computer-driver-build.mjs';

test('driver source validation retains the leading Git porcelain status column', async () => {
  const status = ' M managed.rs\n?? policy.rs\n'; // Test-only Git wire fixture: column one is intentionally blank.
  const result = await runDriverBuild(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(status)})`], process.cwd(), { capture: true });
  const files = result.output.split('\n').map(line => line.slice(3));
  assert.deepEqual(files, ['managed.rs', 'policy.rs']);
});

test('publishes the fresh native build despite inherited Cargo output and target settings', async () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-driver-build-'));
  const profile = 'release', packageName = 'test-driver', executableExtension = '.exe'; // Test-only build contract.
  const host = 'x86_64-pc-windows-msvc'; // Test-only observed Cargo host.
  const inheritedDirectory = path.join(source, 'redirected-by-cargo-config');
  const inheritedTarget = 'unrelated-cross-target'; // Test-only inherited build-target setting.
  const stale = path.join(source, 'target', profile, packageName + executableExtension);
  fs.mkdirSync(path.dirname(stale), { recursive: true }); fs.writeFileSync(stale, 'stale');
  const fixture = path.join(source, 'cargo-fixture.mjs');
  fs.writeFileSync(fixture, `
    import fs from 'node:fs'; import path from 'node:path';
    const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
    if (args[0] === '--version') console.log('host: ${host}');
    if (args[0] === 'build') {
      const dir = args.includes('--target-dir') ? option('--target-dir') : ${JSON.stringify(inheritedDirectory)};
      const target = args.includes('--target') ? option('--target') : ${JSON.stringify(inheritedTarget)};
      const output = path.join(dir, target, option('--profile'), option('-p') + ${JSON.stringify(executableExtension)});
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, 'fresh');
    }
    fs.appendFileSync(${JSON.stringify(path.join(source, 'calls.jsonl'))}, JSON.stringify(args) + '\\n');
  `);
  try {
    const run = (_command, args, cwd, options) => runDriverBuild(process.execPath, [fixture, ...args], cwd, options);
    const executable = await compileDriverExecutable({ source, packageName, profile, executableExtension }, run);
    assert.equal(fs.readFileSync(executable, 'utf8'), 'fresh');
    const calls = fs.readFileSync(path.join(source, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    for (const args of calls.filter(args => ['test', 'build'].includes(args[0]))) {
      assert.equal(args[args.indexOf('--target') + 1], host, 'both commands bind the observed native host');
      assert.ok(args.includes('--target-dir'), 'both commands ignore inherited output directories');
    }
    assert.equal(fs.readFileSync(stale, 'utf8'), 'stale', 'the stale executable was not overwritten or published');
  } finally { fs.rmSync(source, { recursive: true, force: true }); }
});
