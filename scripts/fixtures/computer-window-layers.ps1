param([Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference = 'Stop'
# Read-only Win32 diagnostics: titleless native popups are omitted by list_windows.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class ComputerWindowLayers {
    private const string UserLibrary = "user32.dll"; // Windows ABI, read-only diagnostics.
    private const uint Owner = 4, RootOwner = 3; // GW_OWNER / GA_ROOTOWNER identifiers.
    private const int ExtendedStyle = -20, LabelCapacity = 1024; // GWL_EXSTYLE / UTF-16 characters per diagnostic label.
    private const uint Topmost = 8; // WS_EX_TOPMOST bit; menu windows occupy a separate band.
    private delegate bool Visitor(IntPtr window, IntPtr state);
    [DllImport(UserLibrary)] private static extern bool EnumWindows(Visitor visitor, IntPtr state);
    [DllImport(UserLibrary)] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport(UserLibrary)] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport(UserLibrary, CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport(UserLibrary, CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport(UserLibrary)] private static extern IntPtr GetWindow(IntPtr window, uint relation);
    [DllImport(UserLibrary)] private static extern IntPtr GetAncestor(IntPtr window, uint relation);
    [DllImport(UserLibrary, EntryPoint="GetWindowLongW")] private static extern uint GetWindowLong(IntPtr window, int index);
    [DllImport(UserLibrary)] private static extern IntPtr GetForegroundWindow();
    public static object Read(uint targetPid) {
        var windows = new List<object>(); int z = 0;
        EnumWindows((window, state) => {
            int currentZ = z++; uint pid; GetWindowThreadProcessId(window, out pid);
            var title = new StringBuilder(LabelCapacity); GetWindowText(window, title, LabelCapacity);
            if (IsWindowVisible(window) && (pid == targetPid || title.ToString().StartsWith("Cua.AgentCursorOverlay"))) {
                var cls = new StringBuilder(LabelCapacity); GetClassName(window, cls, LabelCapacity);
                windows.Add(new { window_id=window.ToInt64(), pid, z=currentZ, title=title.ToString(), class_name=cls.ToString(),
                    owner=GetWindow(window, Owner).ToInt64(), root_owner=GetAncestor(window, RootOwner).ToInt64(), topmost=(GetWindowLong(window, ExtendedStyle) & Topmost) != 0 });
            }
            return true;
        }, IntPtr.Zero);
        return new { windows, foreground=GetForegroundWindow().ToInt64() };
    }
}
'@
[ComputerWindowLayers]::Read($TargetProcessId) | ConvertTo-Json -Depth 4 -Compress
