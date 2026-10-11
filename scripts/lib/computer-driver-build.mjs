import { spawn } from 'node:child_process';
import path from 'node:path';

const DEFAULT_BUILD_JOBS = 2; // Compiler processes; bound memory use while the desktop is running.
const CARGO_COMMAND = 'cargo'; // Rust build tool resolved from the developer environment.
const BUILD_CACHE_DIRECTORY = 'ankita-reviewed'; // Dedicated Cargo output; inherited target-dir cannot select a stale executable.
const NATIVE_WINDOWS_TARGET_SUFFIX = '-pc-windows-msvc'; // The external driver must use the observed native Windows MSVC ABI.
const CARGO_HOST_PATTERN = /^host:\s*(\S+)$/m; // Cargo verbose version protocol; discover architecture instead of assuming x64.
export async function runDriverBuild(command, args, cwd, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, env: { ...process.env, RUSTUP_AUTO_INSTALL: '0', CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || String(DEFAULT_BUILD_JOBS) }, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '', diagnostic = '';
    if (capture) { child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { diagnostic += chunk; }); }
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 && !allowFailure) reject(new Error(`${command} ${args[0]} exited ${code}: ${(diagnostic || output).trim()}`));
      else resolve({ code, output: output.trimEnd(), diagnostic: diagnostic.trim() });
    });
  });
}

export async function compileDriverExecutable({ source, packageName, profile, executableExtension }, run = runDriverBuild) {
  const version = await run(CARGO_COMMAND, ['--version', '--verbose'], source, { capture: true });
  const host = version.output.match(CARGO_HOST_PATTERN)?.[1];
  if (!host?.endsWith(NATIVE_WINDOWS_TARGET_SUFFIX)) throw new Error('Cargo must report a native Windows MSVC host target');
  const targetDirectory = path.join(source, 'target', BUILD_CACHE_DIRECTORY);
  const boundTarget = ['--target-dir', targetDirectory, '--target', host];
  await run(CARGO_COMMAND, ['test', '--locked', ...boundTarget, '-p', 'platform-windows', '--lib', 'overlay::', '--', '--test-threads=1'], source);
  await run(CARGO_COMMAND, ['build', '--locked', ...boundTarget, '--profile', profile, '-p', packageName], source);
  return path.join(targetDirectory, host, profile, packageName + executableExtension);
}
