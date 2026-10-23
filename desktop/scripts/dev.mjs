import { startDesktopDev } from './dev-server.mjs';

const dev = await startDesktopDev();
dev.server.printUrls();
const stop = () => { void dev.close().catch(error => { console.error(error); process.exitCode = 1; }); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  const { code, signal } = await dev.closed;
  process.exitCode = code ?? (signal ? 1 : 0);
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
