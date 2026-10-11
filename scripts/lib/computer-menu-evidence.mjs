const OVERLAY_WINDOW_CLASS = 'Cua.AgentCursorOverlay'; // Observed native class from the pinned external driver, never an application menu name.

export function computerOverlayWindow(windows, driverPid) {
  return windows.find(window => window.pid === driverPid && window.class_name === OVERLAY_WINDOW_CLASS);
}
