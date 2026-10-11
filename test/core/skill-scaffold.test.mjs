import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scaffold-profile-'));
process.env.CONFIG_DIR = profile;
after(() => fs.rmSync(profile, { recursive: true, force: true }));
const { checkSkillFixtures } = await import('../../src/skills/fixtures.mjs');

const apiUrl = new URL('../../src/skills/scaffold.mjs', import.meta.url);
async function api() { assert.ok(fs.existsSync(apiUrl), 'skill scaffolder exists'); return import(apiUrl.href); }
function root(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scaffold-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('scaffold creates a loadable documented skill with advisory manifest and passing golden output', async t => {
  const { scaffoldSkill } = await api();
  const dir = root(t);
  const result = scaffoldSkill({ root: dir, name: 'explain-log', permissions: ['files'], example: 'Explain this error log.' });
  assert.equal(path.basename(result), 'explain-log');
  assert.deepEqual(checkSkillFixtures(dir), { checked: 1, errors: [] });
  const manifest = JSON.parse(fs.readFileSync(path.join(result, 'plugin.json'), 'utf8'));
  assert.deepEqual(manifest.permissions, ['files']);
  assert.match(fs.readFileSync(path.join(result, 'README.md'), 'utf8'), /Explain this error log/);
  assert.throws(() => scaffoldSkill({ root: dir, name: 'explain-log', example: 'Other input' }), /exists/);
});

test('scaffold rejects traversal, invalid permissions and empty or multiline frontmatter input before writing', async t => {
  const { scaffoldSkill } = await api();
  const dir = root(t);
  for (const input of [{ name: '../escape', example: 'Hi' }, { name: 'demo', permissions: ['root'], example: 'Hi' }, { name: 'demo', example: '' }]) {
    assert.throws(() => scaffoldSkill({ root: dir, ...input }));
    assert.deepEqual(fs.readdirSync(dir), []);
  }
  scaffoldSkill({ root: dir, name: 'demo', example: 'Explain this\n---\nname: injected' });
  assert.deepEqual(checkSkillFixtures(dir).errors, []);
});

test('new skill works through the real CLI before provider login', async t => {
  const dir = root(t), config = root(t);
  const result = execFileSync(process.execPath, ['chat.mjs', 'new', 'skill', 'offline-demo', '--permissions', 'files', '--example', 'Explain this example', '--directory', dir], { encoding: 'utf8', env: { ...process.env, CONFIG_DIR: config }, timeout: 10000 });
  assert.match(result, /Created skill/);
  assert.deepEqual(checkSkillFixtures(dir).errors, []);
});

test('custom CLI installation roots persist across processes and reach chat, the skill tool and desktop', t => {
  const dir = root(t), first = path.join(dir, 'first'), second = path.join(dir, 'second');
  const env = { ...process.env, CONFIG_DIR: path.join(dir, 'profile') };
  for (const [name, directory] of [['scaffold-check-one', first], ['scaffold-check-two', second], ['scaffold-check-three', first], ['commit-review', second]]) {
    execFileSync(process.execPath, ['chat.mjs', 'new', 'skill', name, '--permissions', 'files', '--example', 'Read this local example', '--directory', directory], { env, encoding: 'utf8', timeout: 10000 });
  }
  const inspect = `
    import { loadSkills, skillsDir } from ${JSON.stringify(new URL('../../src/core/skills.mjs', import.meta.url).href)};
    import { run } from ${JSON.stringify(new URL('../../tools/skills/skill.mjs', import.meta.url).href)};
    import { DesktopEngine } from ${JSON.stringify(new URL('../../desktop/electron/engine.mjs', import.meta.url).href)};
    const catalog = loadSkills();
    console.log(JSON.stringify({
      names: catalog.map(skill => skill.name),
      isolated: loadSkills(${JSON.stringify(first)}).map(skill => skill.name),
      read: run({ name: 'scaffold-check-two' }),
      desktop: DesktopEngine.prototype.listSkills.call({ desktopSettings: { data: {} } }).map(skill => skill.name),
      bundledWins: catalog.find(skill => skill.name === 'commit-review').path.startsWith(skillsDir())
    }));
  `;
  const found = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', inspect], { env, encoding: 'utf8', timeout: 10000 }));
  const names = ['scaffold-check-one', 'scaffold-check-three', 'scaffold-check-two'];
  assert.deepEqual(found.names.filter(name => name.startsWith('scaffold-check-')), names);
  assert.deepEqual(found.desktop.filter(name => name.startsWith('scaffold-check-')), names);
  assert.deepEqual(found.isolated, ['scaffold-check-one', 'scaffold-check-three']);
  assert.match(found.read, /Read this local example/);
  assert.equal(found.names.filter(name => name === 'commit-review').length, 1);
  assert.equal(found.bundledWins, true);
  const listing = execFileSync(process.execPath, ['chat.mjs', '-p', '/skills'], { env, encoding: 'utf8', timeout: 10000 });
  for (const name of names) assert.ok(listing.includes(name), `fresh CLI lists ${name}`);
});

test('interactive scaffolder asks exactly the three author questions', async t => {
  assert.ok(fs.existsSync(new URL('../../src/core/local-commands.mjs', import.meta.url)), 'local commands exist');
  const { runLocalCommand } = await import('../../src/core/local-commands.mjs');
  const dir = root(t), prompts = [], answers = ['interactive-demo', 'files,browser', 'Explain the current page'];
  assert.equal(await runLocalCommand(['new', 'skill', '--directory', dir], { ask: async q => { prompts.push(q); return answers.shift(); }, write: () => {} }), true);
  assert.equal(prompts.length, 3);
  assert.deepEqual(checkSkillFixtures(dir).errors, []);
});

test('failed root registration rolls back the new skill and preserves the existing registry', t => {
  const dir = root(t), directory = path.join(dir, 'custom'), config = path.join(dir, 'profile');
  const registry = path.join(config, 'skill-roots.json'); // Test-only persisted profile fixture.
  fs.mkdirSync(config);
  const env = { ...process.env, CONFIG_DIR: config };
  const inspect = `import { loadSkills } from ${JSON.stringify(new URL('../../src/core/skills.mjs', import.meta.url).href)}; console.log(JSON.stringify(loadSkills().map(skill => skill.name)));`;
  for (const corrupt of ['not valid JSON', JSON.stringify({ version: 999, roots: [] }), JSON.stringify({ version: 1, roots: ['relative-folder'] })]) {
    fs.writeFileSync(registry, corrupt);
    assert.throws(() => execFileSync(process.execPath, ['chat.mjs', 'new', 'skill', 'failed-install', '--permissions', 'files', '--example', 'Read this local example', '--directory', directory], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }));
    assert.equal(fs.existsSync(path.join(directory, 'failed-install')), false);
    assert.equal(fs.readFileSync(registry, 'utf8'), corrupt);
    const names = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', inspect], { env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 }));
    assert.ok(names.includes('commit-review'), 'corrupt custom roots cannot hide bundled skills');
  }
});

test('two real installers retain both roots even when one holds an older registry snapshot', async t => {
  const dir = root(t), registry = path.join(dir, 'skill-roots.json'), release = path.join(dir, 'release');
  const directories = [path.join(dir, 'one'), path.join(dir, 'two')];
  for (const directory of directories) fs.mkdirSync(directory);
  fs.writeFileSync(registry, JSON.stringify({ version: 1, roots: [] }));
  const script = new URL('../../scripts/fixtures/skill-root-registration.mjs', import.meta.url);
  const options = { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, CONFIG_DIR: dir } };
  const children = [];
  t.after(() => { for (const child of children) if (child.exitCode === null) child.kill(); });
  const first = fork(script, [registry, directories[0], release, 'hold'], options); children.push(first);
  const firstExit = once(first, 'exit');
  assert.equal((await once(first, 'message'))[0], 'snapshot');
  const second = fork(script, [registry, directories[1], release, 'normal'], options); children.push(second);
  assert.equal((await once(second, 'exit'))[0], 0);
  fs.writeFileSync(release, 'continue');
  assert.equal((await firstExit)[0], 0);
  const { registeredSkillRoots } = await import('../../src/skills/roots.mjs');
  assert.deepEqual(registeredSkillRoots(registry).sort(), directories.map(directory => fs.realpathSync(directory)).sort());
});

test('a registration storage failure preserves the profile and rolls back only the new skill', t => {
  const dir = root(t), config = path.join(dir, 'profile'), directory = path.join(dir, 'custom');
  fs.mkdirSync(config);
  const blocked = path.join(config, 'skill-roots.json.d'); // Test-only file occupying the registry's records directory.
  fs.writeFileSync(blocked, 'preserve this file');
  assert.throws(() => execFileSync(process.execPath, ['chat.mjs', 'new', 'skill', 'blocked-install', '--permissions', 'files', '--example', 'Read this local example', '--directory', directory], { env: { ...process.env, CONFIG_DIR: config }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }));
  assert.equal(fs.existsSync(path.join(directory, 'blocked-install')), false);
  assert.equal(fs.readFileSync(blocked, 'utf8'), 'preserve this file');
});

test('registration retains legacy roots and ignores incomplete records without creating sequential duplicates', async t => {
  const dir = root(t), registry = path.join(dir, 'skill-roots.json'), oldRoot = root(t), newRoot = root(t);
  const legacy = JSON.stringify({ version: 1, roots: [oldRoot] });
  fs.writeFileSync(registry, legacy);
  const { registeredSkillRoots, registerSkillRoot } = await import('../../src/skills/roots.mjs');
  registerSkillRoot(newRoot, registry);
  registerSkillRoot(newRoot, registry);
  assert.equal(fs.readFileSync(registry, 'utf8'), legacy);
  const records = `${registry}.d`;
  assert.equal(fs.readdirSync(records).length, 1);
  fs.writeFileSync(path.join(records, 'incomplete.tmp'), 'partial JSON');
  assert.deepEqual(registeredSkillRoots(registry), [oldRoot, fs.realpathSync(newRoot)]);
});

test('malformed completed records fail registration and leave bundled discovery available', t => {
  const dir = root(t), config = path.join(dir, 'profile'), directory = path.join(dir, 'custom');
  const records = path.join(config, 'skill-roots.json.d');
  fs.mkdirSync(records, { recursive: true });
  const file = path.join(records, 'corrupt.json');
  const env = { ...process.env, CONFIG_DIR: config };
  const inspect = `import { loadSkills } from ${JSON.stringify(new URL('../../src/core/skills.mjs', import.meta.url).href)}; console.log(JSON.stringify(loadSkills().map(skill => skill.name)));`;
  for (const corrupt of ['partial JSON', JSON.stringify({ version: 999, root: dir, registeredAt: new Date().toISOString() }), JSON.stringify({ version: 1, root: 'relative', registeredAt: new Date().toISOString() }), JSON.stringify({ version: 1, root: dir, registeredAt: 'invalid' })]) {
    fs.writeFileSync(file, corrupt);
    assert.throws(() => execFileSync(process.execPath, ['chat.mjs', 'new', 'skill', 'corrupt-record-install', '--permissions', 'files', '--example', 'Read this local example', '--directory', directory], { env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }));
    assert.equal(fs.existsSync(path.join(directory, 'corrupt-record-install')), false);
    assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
    const names = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', inspect], { env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 }));
    assert.ok(names.includes('commit-review'));
  }
});
