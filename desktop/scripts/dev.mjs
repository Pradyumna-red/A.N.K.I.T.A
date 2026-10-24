import { startDesktopDev } from './dev-server.mjs';

const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']; // Console Ctrl+C/Ctrl+Break, service stop, terminal close.
const dev = await startDesktopDev();
dev.server.printUrls();
const stop = () => { void dev.close().catch(error => { console.error(error); process.exitCode = 1; }); };
for (const signal of STOP_SIGNALS) process.once(signal, stop);
try {
  const { code, signal } = await dev.closed;
  process.exitCode = code ?? (signal ? 1 : 0);
} finally {
  for (const signal of STOP_SIGNALS) process.removeListener(signal, stop);
}
