# Win32 shim: the only place the macropad talks to user32/kernel32/powrprof directly.
# Compiled once per session; dot-sourcing this file again is a no-op.

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

if (-not ('Macropad.Native' -as [type])) {
    $source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Macropad
{
    public static class Native
    {
        public const uint MOD_NOREPEAT = 0x4000;
        public const uint KEYEVENTF_EXTENDEDKEY = 0x1;
        public const uint KEYEVENTF_KEYUP = 0x2;
        public const int WM_HOTKEY = 0x0312;
        public const int SW_HIDE = 0;
        public const int SW_RESTORE = 9;
        // dwExtraInfo tag on the macropad's own input; must equal Macropad.Interop.Signature (lib/cs/Interop.cs).
        public const int MacropadSignature = 0x4D504144;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);
        [DllImport("user32.dll")]
        public static extern short GetKeyState(int nVirtKey);
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
        [DllImport("user32.dll")]
        public static extern uint MapVirtualKey(uint uCode, uint uMapType);
        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);
        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        public static extern bool LockWorkStation();
        [DllImport("kernel32.dll")]
        public static extern IntPtr GetConsoleWindow();
        [DllImport("powrprof.dll")]
        public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern bool BringWindowToTop(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        // Visible top-level windows owned by any of the pids, top of the Z-order first.
        public static IntPtr[] GetProcessWindows(int[] pids)
        {
            HashSet<int> wanted = new HashSet<int>(pids ?? new int[0]);
            List<IntPtr> found = new List<IntPtr>();
            EnumWindowsProc callback = delegate (IntPtr hWnd, IntPtr lParam)
            {
                uint pid;
                GetWindowThreadProcessId(hWnd, out pid);
                if (wanted.Contains((int)pid) && IsWindowVisible(hWnd))
                {
                    found.Add(hWnd);
                }
                return true;
            };
            EnumWindows(callback, IntPtr.Zero);
            GC.KeepAlive(callback);
            return found.ToArray();
        }

        // Bring a window to the foreground despite the foreground lock; true when it worked.
        public static bool ActivateWindow(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return false;
            if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);

            uint ignored;
            uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
            uint currentThread = GetCurrentThreadId();
            bool attached = false;
            if (foregroundThread != 0 && foregroundThread != currentThread)
            {
                attached = AttachThreadInput(currentThread, foregroundThread, true);
            }
            try
            {
                SetForegroundWindow(hWnd);
                BringWindowToTop(hWnd);
            }
            finally
            {
                if (attached) AttachThreadInput(currentThread, foregroundThread, false);
            }

            if (GetForegroundWindow() != hWnd)
            {
                keybd_event(0x12, 0, 0, new UIntPtr((uint)MacropadSignature));
                keybd_event(0x12, 0, KEYEVENTF_KEYUP, new UIntPtr((uint)MacropadSignature));
                SetForegroundWindow(hWnd);
            }
            return GetForegroundWindow() == hWnd;
        }
    }

    public class HotkeyEventArgs : EventArgs
    {
        public HotkeyEventArgs(int id) { Id = id; }
        public int Id { get; private set; }
    }

    // Low-level keyboard hook for one key, on its own thread with its own message loop.
    // The key is swallowed (so a lock key such as ScrollLock never toggles) and its
    // down/up transitions are posted to a window. Running on a dedicated thread means a
    // busy PowerShell thread can never stall keyboard input for the whole system.
    public sealed class KeyHook : IDisposable
    {
        public const int WM_HOOKKEY_DOWN = 0x8001; // WM_APP + 1
        public const int WM_HOOKKEY_UP = 0x8002;   // WM_APP + 2

        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;
        private const uint WM_QUIT = 0x0012;

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public int ptX;
            public int ptY;
        }

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll")]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        private readonly IntPtr target;
        private readonly uint vk;
        private readonly LowLevelKeyboardProc proc;
        private IntPtr hook = IntPtr.Zero;
        private Thread thread;
        private uint threadId;
        private bool down;

        public KeyHook(IntPtr target, uint vk)
        {
            this.target = target;
            this.vk = vk;
            proc = HookProc;
        }

        // Installs the hook on a new background thread; true when SetWindowsHookEx succeeded.
        public bool Start()
        {
            bool installed = false;
            using (ManualResetEvent ready = new ManualResetEvent(false))
            {
                thread = new Thread(delegate ()
                {
                    threadId = GetCurrentThreadId();
                    hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
                    installed = hook != IntPtr.Zero;
                    ready.Set();
                    if (!installed) return;
                    MSG msg;
                    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
                    UnhookWindowsHookEx(hook);
                    hook = IntPtr.Zero;
                });
                thread.IsBackground = true;
                thread.Name = "Macropad key hook";
                thread.Start();
                ready.WaitOne();
            }
            return installed;
        }

        private int lastDownTick;

        // 0 = nothing to post, 1 = post a down, 2 = post an up. Auto-repeat downs post nothing.
        // A down long after the last one is a new press even when its release was never seen:
        // key-ups on another desktop (Win+L, UAC) never reach this hook.
        public int Decide(bool up, int tick)
        {
            if (up)
            {
                down = false;
                return 2;
            }
            bool fresh = !down || unchecked(tick - lastDownTick) > 1500;
            down = true;
            lastDownTick = tick;
            return fresh ? 1 : 0;
        }

        private IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                KBDLLHOOKSTRUCT key = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                // The macropad's own tagged input (Set-LockKeyState, Send-Ahk) passes straight through.
                if (key.vkCode == vk && key.dwExtraInfo.ToInt64() != Native.MacropadSignature)
                {
                    int message = wParam.ToInt32();
                    bool isDown = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
                    bool isUp = message == WM_KEYUP || message == WM_SYSKEYUP;
                    if (isDown || isUp)
                    {
                        int action = Decide(isUp, Environment.TickCount);
                        if (action == 1) PostMessage(target, WM_HOOKKEY_DOWN, new IntPtr((int)vk), IntPtr.Zero);
                        else if (action == 2) PostMessage(target, WM_HOOKKEY_UP, new IntPtr((int)vk), IntPtr.Zero);
                    }
                    return new IntPtr(1);
                }
            }
            return CallNextHookEx(hook, nCode, wParam, lParam);
        }

        public void Dispose()
        {
            if (thread != null && thread.IsAlive)
            {
                PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                thread.Join(1000);
            }
            thread = null;
        }
    }

    // Message-only style window that owns the RegisterHotKey registrations and raises HotkeyPressed,
    // plus the Fn key hook, whose posted transitions it raises as FnDown / FnUp.
    public class HotkeyWindow : NativeWindow, IDisposable
    {
        private readonly List<int> ids = new List<int>();
        private KeyHook fnHook;

        public HotkeyWindow()
        {
            CreateHandle(new CreateParams());
        }

        // Free slot for the PowerShell side to hang state on; event handlers read it from the sender.
        public object Context { get; set; }

        public event EventHandler<HotkeyEventArgs> HotkeyPressed;
        public event EventHandler FnDown;
        public event EventHandler FnUp;

        // Swallows the Fn key system-wide and raises FnDown / FnUp for it; false when the hook failed.
        public bool HookFnKey(uint vk)
        {
            if (fnHook != null) fnHook.Dispose();
            fnHook = new KeyHook(Handle, vk);
            if (fnHook.Start()) return true;
            fnHook.Dispose();
            fnHook = null;
            return false;
        }

        public bool Register(int id, uint modifiers, uint vk)
        {
            bool ok = Native.RegisterHotKey(Handle, id, modifiers, vk);
            if (ok && !ids.Contains(id)) ids.Add(id);
            return ok;
        }

        public bool Unregister(int id)
        {
            ids.Remove(id);
            return Native.UnregisterHotKey(Handle, id);
        }

        public void UnregisterAll()
        {
            foreach (int id in ids.ToArray())
            {
                Native.UnregisterHotKey(Handle, id);
            }
            ids.Clear();
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Native.WM_HOTKEY)
            {
                EventHandler<HotkeyEventArgs> handler = HotkeyPressed;
                if (handler != null) handler(this, new HotkeyEventArgs(m.WParam.ToInt32()));
                return;
            }
            if (m.Msg == KeyHook.WM_HOOKKEY_DOWN || m.Msg == KeyHook.WM_HOOKKEY_UP)
            {
                EventHandler handler = m.Msg == KeyHook.WM_HOOKKEY_DOWN ? FnDown : FnUp;
                if (handler != null) handler(this, EventArgs.Empty);
                return;
            }
            base.WndProc(ref m);
        }

        public void Dispose()
        {
            if (fnHook != null)
            {
                fnHook.Dispose();
                fnHook = null;
            }
            if (Handle != IntPtr.Zero)
            {
                UnregisterAll();
                DestroyHandle();
            }
        }
    }

    // Overlay window that never takes focus, so clicks and keys stay with the app the user was in.
    public class OverlayForm : Form
    {
        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x08000000 /* WS_EX_NOACTIVATE */ | 0x80 /* WS_EX_TOOLWINDOW */;
                return cp;
            }
        }
    }
}
'@
    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms, System.Drawing
}
