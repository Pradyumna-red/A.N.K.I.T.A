import { spawn } from 'node:child_process';

const DEFAULT_BUILD_JOBS = 2; // Compiler processes; bound memory use while the desktop is running.
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
