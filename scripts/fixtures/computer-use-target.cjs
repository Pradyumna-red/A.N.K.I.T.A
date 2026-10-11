// Controlled desktop test app. No files, accounts, network, or personal applications are touched.
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('force-renderer-accessibility'); // Test surface must expose its controls to the native UIA service.
const title = process.env.ANKITA_COMPUTER_TEST_TITLE;
const READBACK_INTERVAL_MS = 200; // Milliseconds; independently observe the disposable renderer even when it is not focused.
if (!title) throw new Error('A unique test title is required');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ title, width: 720, height: 480, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<title>${title}</title><h1>ANKITA computer control check</h1><label for="note">Verification note</label><input id="note" aria-label="Verification note"><button id="action" onclick="document.getElementById('status').textContent='Action confirmed'">Confirm action</button><p id="status" role="status">Waiting for action</p>`));
  window.showInactive();
  console.log(JSON.stringify({ ready: true, pid: process.pid, title }));
  setInterval(async () => {
    const state = await window.webContents.executeJavaScript("({ note: document.getElementById('note').value, status: document.getElementById('status').textContent })");
    console.log(JSON.stringify({ appOwnedState: state }));
  }, READBACK_INTERVAL_MS);
});
app.on('window-all-closed', () => app.quit());
