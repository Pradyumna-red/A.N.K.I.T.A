import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileDriverExecutable, runDriverBuild as run } from './lib/computer-driver-build.mjs';
import { createHash } from 'node:crypto';
import { CONFIG_DIR } from '../src/core/config.mjs';
import { COMPUTER_DRIVER_NAME, COMPUTER_SUPPORTED_PLATFORM } from '../src/integrations/computer-use.mjs';

const VENDOR_DIRECTORY = fileURLToPath(new URL('../vendor/cua-driver/', import.meta.url)); // Repository asset path; source provenance lives beside the source change.
const SOURCE = JSON.parse(fs.readFileSync(path.join(VENDOR_DIRECTORY, 'source.json'), 'utf8'));
const DRIVER_DIRECTORY = path.join(CONFIG_DIR, 'computer-driver'); // External service build cache, outside Electron and the user's documents.
const GIT_COMMAND = 'git'; // Resolved from PATH; missing developer tools fail before changing the saved MCP connection.
const EXECUTABLE_EXTENSION = '.exe'; // This source change targets Windows native window ownership.
const BUILD_PROFILE = 'release'; // Optimized cursor rendering and native input, matching the official distribution.
const BUILD_INFO_FILE = 'build-info.json'; // Local provenance receipt, including the executable and source-change hashes.
const UPSTREAM_LICENSE_FILE = 'LICENSE.md'; // Official repository's license file, retained in the external distribution.

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`${name} requires a path`);
  return path.resolve(process.argv[index + 1]);
}

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

if (process.platform !== COMPUTER_SUPPORTED_PLATFORM) throw new Error('Build the computer driver from a Windows Rust/MSVC development environment');
const repository = option('--source', path.join(DRIVER_DIRECTORY, 'source'));
const output = option('--output', path.join(DRIVER_DIRECTORY, 'windows-owned-popups'));
const patch = path.join(VENDOR_DIRECTORY, SOURCE.patch);
await run(GIT_COMMAND, ['--version'], process.cwd(), { capture: true });
if (!fs.existsSync(repository)) {
  fs.mkdirSync(path.dirname(repository), { recursive: true });
  await run(GIT_COMMAND, ['clone', '--filter=blob:none', '--sparse', '--no-checkout', SOURCE.repository, repository], process.cwd());
  await run(GIT_COMMAND, ['sparse-checkout', 'set', SOURCE.sourceDirectory], repository);
  await run(GIT_COMMAND, ['checkout', '--detach', SOURCE.revision], repository);
}
const revision = (await run(GIT_COMMAND, ['rev-parse', 'HEAD'], repository, { capture: true })).output;
if (revision !== SOURCE.revision) throw new Error('Driver source revision differs from the reviewed source; use a separate source directory');
const applied = await run(GIT_COMMAND, ['apply', '--reverse', '--check', patch], repository, { capture: true, allowFailure: true });
if (applied.code !== 0) {
  await run(GIT_COMMAND, ['apply', '--check', patch], repository, { capture: true });
  await run(GIT_COMMAND, ['apply', patch], repository);
}
// A commit ID does not prove a developer-provided checkout is unchanged.
// Require every source edit to match this exact reviewed diff before compiling.
const changedFiles = fs.readFileSync(patch, 'utf8').split(/^diff --git /m).slice(1).map(section => ({
  file: section.split('\n')[0].split(' b/')[1].trim(),
  blob: section.match(/^index [a-f0-9]+\.\.([a-f0-9]+)/m)?.[1],
}));
const status = (await run(GIT_COMMAND, ['status', '--porcelain', '--untracked-files=all'], repository, { capture: true })).output;
const unexpected = status.split('\n').filter(Boolean).map(line => line.slice(3).trim()).filter(file => !changedFiles.some(change => change.file === file));
if (unexpected.length) throw new Error(`Driver source has changes outside the reviewed diff: ${unexpected.join(', ')}`);
for (const change of changedFiles) {
  const blob = (await run(GIT_COMMAND, ['hash-object', `--path=${change.file}`, change.file], repository, { capture: true })).output;
  if (!change.blob || !blob.startsWith(change.blob)) throw new Error(`Driver source differs from the reviewed content: ${change.file}`);
}
const source = path.join(repository, SOURCE.sourceDirectory);
const lockBefore = hash(path.join(source, 'Cargo.lock'));
const executable = await compileDriverExecutable({ source, packageName: COMPUTER_DRIVER_NAME, profile: BUILD_PROFILE, executableExtension: EXECUTABLE_EXTENSION });
if (hash(path.join(source, 'Cargo.lock')) !== lockBefore) throw new Error('Driver build changed its dependency lockfile');
// Publish into the caller-selected external service directory; connecting it remains an explicit product action.
fs.mkdirSync(output, { recursive: true });
const installed = path.join(output, path.basename(executable));
fs.copyFileSync(executable, installed);
fs.copyFileSync(path.join(repository, UPSTREAM_LICENSE_FILE), path.join(output, UPSTREAM_LICENSE_FILE));
fs.writeFileSync(path.join(output, BUILD_INFO_FILE), JSON.stringify({ repository: SOURCE.repository, revision, version: SOURCE.version, patchSha256: hash(patch), cargoLockSha256: lockBefore, executableSha256: hash(installed) }, null, 2));
console.log(JSON.stringify({ built: true, executable: installed, provenance: path.join(output, BUILD_INFO_FILE) }));
