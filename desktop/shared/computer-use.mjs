// Electron IPC identifiers; one contract shared by main process, renderer and live harness.
export const COMPUTER_USE_ACTIONS = Object.freeze({
  overview: 'computerUseOverview', connect: 'computerUseConnect', check: 'computerUseCheck', stop: 'computerUseStop',
  pointer: 'computerUseSetPointer',
});
export const COMPUTER_USE_CHANGED = 'computer-use-changed';
export const COMPUTER_USE_LABEL = 'Computer Use'; // Product name shared by the Plugins heading and persisted MCP record.
