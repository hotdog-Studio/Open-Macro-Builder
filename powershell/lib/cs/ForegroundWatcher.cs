using System;
using System.Runtime.InteropServices;

namespace Macropad
{
    // Raises Changed on the UI thread when the foreground window changes, or when the foreground
    // window's title changes (a browser switching tabs). NameHookProcessId shows which process
    // the title hook currently listens to. Out-of-context WinEvent hooks are
    // delivered through the creating thread's message loop, so create it on the UI thread.
    public sealed class ForegroundWatcher : IDisposable
    {
        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint EVENT_OBJECT_NAMECHANGE = 0x800C;
        private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
        private const int OBJID_WINDOW = 0;

        private delegate void WinEventProc(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

        [DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventProc lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);
        [DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(IntPtr hWinEventHook);
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        private readonly WinEventProc proc;
        private IntPtr foregroundHook;
        private IntPtr nameHook;
        private uint namePid;

        public event EventHandler Changed;
        public object Context { get; set; }

        public ForegroundWatcher()
        {
            proc = OnWinEvent;
            foregroundHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, proc, 0, 0, WINEVENT_OUTOFCONTEXT);
            WatchTitlesOf(GetForegroundWindow());
        }

        // The process whose title changes are being heard (0 when none).
        public int NameHookProcessId { get { return nameHook != IntPtr.Zero ? (int)namePid : 0; } }

        // Only the foreground window's title matters, so the name-change hook listens to that
        // window's process alone and moves with the foreground. A system-wide hook would bring every
        // title change in every process to the UI thread.
        private void WatchTitlesOf(IntPtr hwnd)
        {
            uint pid = 0;
            if (hwnd != IntPtr.Zero) GetWindowThreadProcessId(hwnd, out pid);
            if (pid == namePid && nameHook != IntPtr.Zero) return;
            if (nameHook != IntPtr.Zero) { UnhookWinEvent(nameHook); nameHook = IntPtr.Zero; }
            namePid = pid;
            if (pid != 0) nameHook = SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, IntPtr.Zero, proc, pid, 0, WINEVENT_OUTOFCONTEXT);
        }

        private void OnWinEvent(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
        {
            if (eventType == EVENT_SYSTEM_FOREGROUND) WatchTitlesOf(hwnd);
            if (eventType == EVENT_OBJECT_NAMECHANGE && (idObject != OBJID_WINDOW || hwnd != GetForegroundWindow())) return;
            EventHandler handler = Changed;
            if (handler != null) handler(this, EventArgs.Empty);
        }

        public void Dispose()
        {
            if (foregroundHook != IntPtr.Zero) { UnhookWinEvent(foregroundHook); foregroundHook = IntPtr.Zero; }
            if (nameHook != IntPtr.Zero) { UnhookWinEvent(nameHook); nameHook = IntPtr.Zero; }
        }
    }
}
