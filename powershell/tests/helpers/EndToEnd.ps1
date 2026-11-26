# The harness of the end-to-end test (EndToEnd.Tests.ps1): it makes the desktop the test's own, starts
# a real macropad, presses real keys with SendInput from this process, reads what happened, and puts
# everything back. Dot-source it after lib\Native.ps1, Interop.ps1, Pump.ps1, Input.ps1, AhkSyntax.ps1,
# WinTitle.ps1, WindowOps.ps1, Window.ps1 and the helpers Ahk.ps1 and CommandSource.ps1; a run that
# points at the overlay (Get-E2eOverlayPoint) also needs lib\Assets.ps1, Model.ps1 and ConfigJson.ps1,
# whose model of a layout both macropads draw their overlay from.
#
# The keys go through SendInput untagged, as a keyboard's would: not through [Macropad.Inject], whose
# tag the PowerShell macropad ignores, and not from an AutoHotkey script, whose input AutoHotkey's hook
# hotkeys ignore.
#
# A case that fails also says what the keyboard and the desktop were, read before its clean-up lets go
# of any key (Get-E2eFailureState): the keys Windows has down, the key watch's record of injected keys
# (and, in the NextWindow cases, of the windows that came in front), the pointer and the visible windows.
# The NextWindow cases also print, passed or failed, when their Alt+Tab went out (Get-E2eChordTimes).

if (-not ('OmbE2e.Input' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace OmbE2e
{
    public static class Input
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT { public uint type; public InputUnion u; }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
        [DllImport("user32.dll")]
        private static extern uint MapVirtualKey(uint uCode, uint uMapType);
        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT p);
        [DllImport("user32.dll")]
        private static extern IntPtr WindowFromPoint(POINT p);
        [DllImport("user32.dll")]
        private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        // One key event, with no tag in dwExtraInfo; 1 when Windows took it.
        public static uint Key(int vk, bool up, bool extended)
        {
            INPUT[] input = new INPUT[1];
            input[0].type = 1;
            input[0].u.ki.wVk = (ushort)vk;
            input[0].u.ki.wScan = (ushort)MapVirtualKey((uint)vk, 0);
            input[0].u.ki.dwFlags = (up ? 2u : 0u) | (extended ? 1u : 0u);
            return SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
        }

        // One mouse button event at the pointer (flags as in MOUSEINPUT: 2/4 left, 8/16 right).
        public static uint Mouse(uint flags)
        {
            INPUT[] input = new INPUT[1];
            input[0].type = 0;
            input[0].u.mi.dwFlags = flags;
            return SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
        }

        public static bool MoveMouse(int x, int y) { return SetCursorPos(x, y); }
        public static int[] MousePosition() { POINT p; GetCursorPos(out p); return new int[] { p.X, p.Y }; }

        // The top-level window at a point of the screen, as Windows finds the window a click there
        // goes to (a pixel a layered window keys out as transparent is not that window's), or
        // IntPtr.Zero for none.
        public static IntPtr TopWindowAt(int x, int y)
        {
            POINT p; p.X = x; p.Y = y;
            IntPtr h = WindowFromPoint(p);
            return h == IntPtr.Zero ? h : GetAncestor(h, 2);  // GA_ROOT
        }
    }

    // The requests WatchFront posts to the key watch's thread and that thread's answers, each answer told
    // to its request by a number. An answer that comes late (the thread was busy past WatchFront's wait)
    // then cannot be taken for the answer to the request after it.
    public sealed class FrontReplies
    {
        private readonly object gate = new object();
        private int asked;
        private int answered;

        // The number of a new request.
        public int Ask() { lock (gate) return ++asked; }

        // The thread has done request seq, and so every one before it.
        public void Answer(int seq)
        {
            lock (gate) { if (seq > answered) answered = seq; System.Threading.Monitor.PulseAll(gate); }
        }

        // True when request seq or a later one has been answered within ms.
        public bool Wait(int seq, int ms)
        {
            System.Diagnostics.Stopwatch clock = System.Diagnostics.Stopwatch.StartNew();
            lock (gate)
            {
                while (answered < seq)
                {
                    long left = ms - clock.ElapsedMilliseconds;
                    if (left <= 0) return false;
                    System.Threading.Monitor.Wait(gate, (int)left);
                }
                return true;
            }
        }
    }

    // A low-level keyboard hook on its own thread, for keys that Windows takes before any window gets
    // them (Win key chords, Print Screen, media keys). It records only injected keys (sent by a
    // program), never what a person types, and while Swallow is on it stops injected keys other than
    // F13 to F24 from reaching Windows, so a chord is seen without being carried out.
    // For the account of a failed case (Get-E2eFailureState) and the timing of NextWindow
    // (Get-E2eChordTimes) it also keeps a timed record since the last Clear: every injected key, the
    // macro keys among them, with its tag; and, while WatchFront is on, every change of the window in
    // front, from a WinEvent hook on the same thread. Each line has the time on the high-resolution
    // clock that Now() reads, taken in this thread's callback: for a key, when this hook saw it, before
    // Windows went on with it; for a window, when this thread was told of it. Windows tells an
    // out-of-context WinEvent hook later than the change, so that time is an upper bound: the window
    // came in front then or earlier. Both are taken on this one thread, so the record's order is the
    // order of those times. Nothing here attaches to another thread's input.
    public static class KeyWatch
    {
        private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
        private delegate void WinEventProc(IntPtr hook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }
        [StructLayout(LayoutKind.Sequential)]
        private struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll")]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint min, uint max);
        [DllImport("user32.dll")]
        private static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr module, WinEventProc proc, uint pid, uint thread, uint flags);
        [DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(IntPtr hook);
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hwnd, System.Text.StringBuilder name, int size);
        // The title as Windows keeps it, without asking the window (GetWindowText would send a window of
        // this process a message, and this thread must never wait on another).
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int InternalGetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int size);

        private static readonly HookProc proc = Callback;
        private static readonly WinEventProc frontProc = OnFront;
        private static IntPtr hook = IntPtr.Zero;
        private static volatile IntPtr frontHook = IntPtr.Zero;
        private static uint threadId;
        private static System.Threading.Thread thread;
        private static readonly System.Collections.Generic.List<string> events = new System.Collections.Generic.List<string>();
        private static readonly System.Collections.Generic.List<string> timed = new System.Collections.Generic.List<string>();
        private const int TimedMax = 2000;
        // WM_APP + 9, posted to this thread: wParam 1 sets the WinEvent hook, 0 removes it; lParam is the
        // number of the request (FrontReplies).
        private const uint WM_WATCHFRONT = 0x8009;
        private static readonly FrontReplies frontReplies = new FrontReplies();
        public static volatile bool Swallow;

        public static bool Start()
        {
            if (thread != null) return hook != IntPtr.Zero;
            bool ok = false;
            using (System.Threading.ManualResetEvent ready = new System.Threading.ManualResetEvent(false))
            {
                thread = new System.Threading.Thread(delegate ()
                {
                    threadId = GetCurrentThreadId();
                    hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0);
                    ok = hook != IntPtr.Zero;
                    ready.Set();
                    if (!ok) return;
                    MSG msg;
                    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
                    {
                        if (msg.message != WM_WATCHFRONT) continue;
                        // EVENT_SYSTEM_FOREGROUND, out of context: called on this thread, between its
                        // messages, so it is set and removed here.
                        if (msg.wParam != IntPtr.Zero && frontHook == IntPtr.Zero) frontHook = SetWinEventHook(3, 3, IntPtr.Zero, frontProc, 0, 0, 0);
                        else if (msg.wParam == IntPtr.Zero && frontHook != IntPtr.Zero) { UnhookWinEvent(frontHook); frontHook = IntPtr.Zero; }
                        frontReplies.Answer((int)msg.lParam);
                    }
                    if (frontHook != IntPtr.Zero) UnhookWinEvent(frontHook);
                    frontHook = IntPtr.Zero;
                    UnhookWindowsHookEx(hook);
                    hook = IntPtr.Zero;
                });
                thread.IsBackground = true;
                thread.Start();
                ready.WaitOne();
            }
            return ok;
        }

        public static void Stop()
        {
            Swallow = false;
            if (thread == null) return;
            PostThreadMessage(threadId, 0x12, IntPtr.Zero, IntPtr.Zero);
            thread.Join(2000);
            thread = null;
        }

        // The events recorded since the last Clear, as "down|up <vk hex>".
        public static string[] Events() { lock (events) return events.ToArray(); }

        // The timed record since the last Clear, in the order this thread got its lines, one
        // tab-separated line each (ms: on the clock Now() reads, one decimal):
        //   key    <ms> <down|up> <vk hex> <dwExtraInfo hex>  an injected key, the macro keys too
        //   front  <ms> <pid> <class> <title>                 the window in front changed; the first
        //                                                     line: the one in front at Clear
        // Neither a class nor a title holds a tab. At most the last TimedMax lines are kept.
        public static string[] Timed() { lock (events) return timed.ToArray(); }

        // True while the record has the changes of the window in front.
        public static bool WatchesFront { get { return frontHook != IntPtr.Zero; } }

        // Sets (on) or removes the WinEvent hook that records the changes of the window in front, on the
        // hook's own thread; true when it is as asked within 2 s. Off by default: the run turns it on
        // only during the cases of the commands it times (E2eTimedCommands).
        public static bool WatchFront(bool on)
        {
            if (thread == null || hook == IntPtr.Zero) return false;
            int seq = frontReplies.Ask();
            if (!PostThreadMessage(threadId, WM_WATCHFRONT, new IntPtr(on ? 1 : 0), new IntPtr(seq))) return false;
            if (!frontReplies.Wait(seq, 2000)) return false;
            return (frontHook != IntPtr.Zero) == on;
        }

        // The high-resolution clock now, in ms: the clock of the record's times.
        public static double Now() { return System.Diagnostics.Stopwatch.GetTimestamp() * 1000.0 / System.Diagnostics.Stopwatch.Frequency; }

        public static void Clear()
        {
            lock (events)
            {
                events.Clear();
                timed.Clear();
                AddTimed(FrontLine(GetForegroundWindow(), Now()));
            }
        }

        // Under the lock of events.
        private static void AddTimed(string line)
        {
            if (timed.Count >= TimedMax) timed.RemoveAt(0);
            timed.Add(line);
        }

        private static string Ms(double ms) { return ms.ToString("F1", System.Globalization.CultureInfo.InvariantCulture); }

        private static string FrontLine(IntPtr hwnd, double seen)
        {
            uint pid = 0;
            System.Text.StringBuilder name = new System.Text.StringBuilder(256);
            System.Text.StringBuilder title = new System.Text.StringBuilder(256);
            if (hwnd != IntPtr.Zero)
            {
                GetWindowThreadProcessId(hwnd, out pid);
                GetClassName(hwnd, name, name.Capacity);
                InternalGetWindowText(hwnd, title, title.Capacity);
            }
            return "front\t" + Ms(seen) + "\t" + pid + "\t" + Plain(name.ToString()) + "\t" + Plain(title.ToString());
        }

        private static string Plain(string text) { return text.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' '); }

        private static void OnFront(IntPtr winEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint eventThread, uint time)
        {
            // The clock first: the time this thread was told, before the window is read.
            double seen = Now();
            string line = FrontLine(hwnd, seen);
            lock (events) AddTimed(line);
        }

        private static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                bool injected = (k.flags & 0x10) != 0;
                bool up = (k.flags & 0x80) != 0;
                bool macroKey = k.vkCode >= 0x7C && k.vkCode <= 0x87;
                if (injected)
                {
                    string line = "key\t" + Ms(Now()) + "\t" + (up ? "up" : "down") + "\t" + k.vkCode.ToString("X2") + "\t" + k.dwExtraInfo.ToInt64().ToString("X");
                    lock (events) AddTimed(line);
                }
                if (injected && !macroKey)
                {
                    lock (events) events.Add((up ? "up " : "down ") + k.vkCode.ToString("X2"));
                    if (Swallow) return new IntPtr(1);
                }
            }
            return CallNextHookEx(hook, nCode, wParam, lParam);
        }
    }
}
'@
}

if (-not ('OmbE2e.ProcessInfo' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace OmbE2e
{
    // The working directory of another (64-bit) process of the same user, read from its process
    // parameters, so that a macropad the test stops can be started again where it was started.
    public static class ProcessInfo
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_BASIC_INFORMATION { public IntPtr Reserved1; public IntPtr PebBaseAddress; public IntPtr Reserved2a; public IntPtr Reserved2b; public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId; }
        [DllImport("ntdll.dll")]
        private static extern int NtQueryInformationProcess(IntPtr process, int infoClass, ref PROCESS_BASIC_INFORMATION info, int size, out int returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, IntPtr size, out IntPtr read);
        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint size);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
            public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
            public int dwFlags; public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcess(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
            bool inheritHandles, uint flags, string environment, string currentDirectory, ref STARTUPINFO startup, out PROCESS_INFORMATION info);

        // Starts a program that outlives this process and holds none of its handles (a program started
        // with inherited handles keeps a caller's output pipe open, and the caller waits for it), with
        // exactly this environment ("NAME=value" entries) and no console window. Its pid, or 0.
        public static int StartDetached(string exe, string arguments, string directory, string[] environment)
        {
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            PROCESS_INFORMATION info;
            StringBuilder line = new StringBuilder("\"" + exe + "\"" + (string.IsNullOrEmpty(arguments) ? "" : " " + arguments));
            string block = string.Join("\0", environment) + "\0\0";
            if (string.IsNullOrEmpty(directory)) directory = null;
            // CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW (a console program gets no window; others ignore it)
            if (!CreateProcess(exe, line, IntPtr.Zero, IntPtr.Zero, false, 0x00000400 | 0x08000000, block, directory, ref startup, out info)) return 0;
            CloseHandle(info.hThread);
            CloseHandle(info.hProcess);
            return info.dwProcessId;
        }

        // The long form of a path that may hold 8.3 short names (C:\Users\THOMAS~1\...), as processes
        // report their own paths.
        public static string LongPath(string path)
        {
            StringBuilder sb = new StringBuilder(1024);
            uint n = GetLongPathName(path, sb, (uint)sb.Capacity);
            return n == 0 || n >= sb.Capacity ? path : sb.ToString();
        }

        private static byte[] Read(IntPtr process, IntPtr address, int size)
        {
            byte[] buffer = new byte[size];
            IntPtr read;
            if (!ReadProcessMemory(process, address, buffer, new IntPtr(size), out read) || read.ToInt64() != size) return null;
            return buffer;
        }

        // null when it cannot be read: a process of another user or an elevated one, or any process
        // when this one is 32-bit. A 32-bit process is read too, its directory as it is now.
        public static string CurrentDirectory(int pid)
        {
            if (IntPtr.Size != 8) return null;
            IntPtr process = OpenProcess(0x0410, false, pid);  // PROCESS_QUERY_INFORMATION | PROCESS_VM_READ
            if (process == IntPtr.Zero) return null;
            try
            {
                PROCESS_BASIC_INFORMATION info = new PROCESS_BASIC_INFORMATION();
                int returned;
                if (NtQueryInformationProcess(process, 0, ref info, Marshal.SizeOf(info), out returned) != 0) return null;
                byte[] peb = Read(process, new IntPtr(info.PebBaseAddress.ToInt64() + 0x20), 8);  // PEB.ProcessParameters
                if (peb == null) return null;
                IntPtr parameters = new IntPtr(BitConverter.ToInt64(peb, 0));
                byte[] cwd = Read(process, new IntPtr(parameters.ToInt64() + 0x38), 16);  // CurrentDirectory.DosPath
                if (cwd == null) return null;
                int length = BitConverter.ToUInt16(cwd, 0);
                IntPtr text = new IntPtr(BitConverter.ToInt64(cwd, 8));
                byte[] chars = Read(process, text, length);
                return chars == null ? null : Encoding.Unicode.GetString(chars);
            }
            finally { CloseHandle(process); }
        }
    }
}
'@
}

$script:E2eRepo = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$script:E2eFixtures = Join-Path $script:E2eRepo 'ahk\tests\e2e'
$script:E2eFloorMs = 350
# How long a check before a press waits for the window it expects, while one of the test's own windows
# still has the keyboard (Wait-E2eFront).
$script:E2eFrontMs = 3000
# How long a tooltip of the macropad's may still show once its overlay is seen hidden, Fn let go with the
# pointer left where the case put it (Invoke-E2eOverlayPointer): in both versions the tooltip goes with
# the overlay, each by its own mechanism. The PowerShell macropad switches its ToolTip off and on again in
# Hide-Overlay, in the handler that hides the form; the Active setter of System.Windows.Forms 4.8 (read by
# reflection) sends the tooltip control TTM_ACTIVATE. AutoHotkey's goes in OnMouseEvent (ahk/lib/io.ahk)
# on WM_MOUSELEAVE, which Windows posts to the overlay's window after TrackMouseEvent (TME_LEAVE) once the
# pointer is no longer over it; whether that comes when the window hides under a pointer that does not
# move is in no documentation read for this, and no timer of the script takes the tip away. So the
# pointer stays still until this wait is over, and the line each case prints (Format-E2eOverlayTooltipTime)
# says how long the tip took. Build #4's case times did not measure it (E2eOverlayLabel took 4.46 s in
# AutoHotkey and 3.38 s in PowerShell, E2eOverlayIcon 4.89 s and 8.6 s, 4.8 s of the last this wait).
# The limit is what separates the PowerShell tip of before 1.0.7, which ran out its own 5 s (AutoPopDelay)
# from when it showed, from one that goes with the overlay. E2eOverlayIcon lets Fn go with a tip that it
# saw up at its last step, within one look (50 ms) of its showing; then come the pacing floor (350 ms at
# most), the look whether a tooltip shows, Fn's release and the wait for the overlay to hide (in build #4,
# in the order before this one, 193 ms of the 5 s had passed when this wait began). The wait for the hide
# may take up to 3 s, which would leave too little of the 5 s: so that case fails when this wait began
# more than $script:E2eTooltipProofMs after its last step. Within that, more than 5000 - 1500 - 100 =
# 3400 ms of an old tip are left when this wait begins, so a tip left to run out fails the limit by more
# than 900 ms.
$script:E2eTooltipGoneMs = 2500
$script:E2eTooltipProofMs = 1500
$script:E2eChangeClock = $null
$script:E2eWarning = 'Photosensitivity warning: this test opens, moves and closes windows. Look away if flashing affects you.'
# The banner's window (ahk\tests\e2e\banner.ahk), as Find-Window reads it.
$script:E2eBannerWindow = 'Open Macro Builder end-to-end test ahk_class AutoHotkeyGUI'
# Fn is F24 and the macro keys are F13 to F23 in the test's layouts: keys no keyboard in the room has.
$script:E2eFnVk = 0x87
$script:E2eFirstKeyVk = 0x7C
$script:E2eKeyCount = 11
# The layout file's hotkeys and hotstrings, in the layout of the cases with Hooks only (Write-E2eLayout):
# a hotkey with no window condition, one only while the stand-in B's program (e2eapp.exe) is active, one
# only while it is not, a hotstring that types a replacement and one that runs an action. E2eHotkey (the
# test's own command) writes its macro's name, the hotkey or the hotstring as written here, to hotkeys.log.
$script:E2eHookLayout = [ordered]@{
    hotkeys    = @(
        [ordered]@{ hotkey = '^!F9'; action = 'E2eHotkey' }
        [ordered]@{ hotkey = '^!F10'; action = 'E2eHotkey'; ifWinActive = 'ahk_exe e2eapp.exe' }
        [ordered]@{ hotkey = '^!F11'; action = 'E2eHotkey'; ifWinNotActive = 'ahk_exe e2eapp.exe' }
    )
    hotstrings = @(
        [ordered]@{ hotstring = '::e2ebtw'; replacement = 'by the way' }
        [ordered]@{ hotstring = ':X:e2erun'; action = 'E2eHotkey' }
    )
}
# The keys a run may hold down: Shift, Ctrl, Alt (both sides), the Windows keys, and Fn.
$script:E2eHoldableVk = @(0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C, 0x87)
# The variables run.ps1 sets for the test: no program the test starts gets them, but for OMB_E2E, which
# the macropad under test gets again (Get-E2eMacropadEnvironment).
$script:E2eOwnVariables = @('OMB_E2E', 'OMB_E2E_CASE', 'OMB_E2E_CI', 'OMB_E2E_LIMIT', 'OMB_E2E_REPEAT')
# The windows of Windows' own shell that can come up by themselves and take the keyboard (Snap Assist,
# Task View, the desktop, the taskbar), and the desktop itself, which a key may leave in front (on a
# new virtual desktop, explorer.exe's untitled ExplorerBrowserOwner may hold the keyboard).
$script:E2eShellClasses = @('XamlExplorerHostIslandWindow', 'Progman', 'WorkerW', 'Shell_TrayWnd')
$script:E2eDesktopClasses = @('Progman', 'WorkerW', 'Shell_TrayWnd', 'ExplorerBrowserOwner')

# ---------------------------------------------------------------------------------------------------
# Pacing: at most three changes of the screen a second.

<#
.SYNOPSIS
Keeps the screen from changing more than about three times a second during the end-to-end test.
.DESCRIPTION
Call it right before anything that shows, hides, moves, sizes, maximizes, minimizes or restores a
window, brings one to the front, or shows or hides the macropad's overlay, including a key press that
makes a command do so. It waits until at least FloorMs have passed since the previous change, then
counts the coming change as now. With -Observed it waits for nothing and only records that a change
has just been seen to happen (a window that appeared some time after the key), so the next change
keeps its distance from that one. It is a floor on how fast the screen may change, never how a case
decides pass or fail.
#>
function Wait-ScreenChange {
    param([switch]$Observed)
    if (-not $Observed -and $null -ne $script:E2eChangeClock) {
        $left = $script:E2eFloorMs - $script:E2eChangeClock.ElapsedMilliseconds
        if ($left -gt 0) { Wait-Pump $left }
    }
    $script:E2eChangeClock = [System.Diagnostics.Stopwatch]::StartNew()
}

# ---------------------------------------------------------------------------------------------------
# Waiting for a condition, within the case's own limit and the run's. The clean-up runs without the
# run's limit (Complete-E2eRun lifts it), so a run that ran out of time still cleans up.

function Assert-E2eTime {
    if ($null -ne $script:E2eRun -and [DateTime]::UtcNow -gt $script:E2eRun.Deadline) {
        throw "The end-to-end run passed its time limit of $($script:E2eRun.LimitMinutes) minutes; it stops here and cleans up."
    }
}

# Calls Condition about every 50 ms until it returns something other than $null or $false, and returns
# that; $null when TimeoutMs pass first. The limit is time spent waiting: it runs from the end of the
# first look, and the first look is always followed by another, however long it took (the first one in
# a process can take longer than a short limit). A wait that is met only after two thirds of its limit
# is noted (Add-E2eSlowWait), and the run lists those at its end.
function Wait-E2eCondition {
    param([Parameter(Mandatory)][scriptblock]$Condition, [int]$TimeoutMs = 5000, [int]$EveryMs = 50)
    $sw = [System.Diagnostics.Stopwatch]::new()
    while ($true) {
        Assert-E2eTime
        $value = & $Condition
        if ($null -ne $value -and $value -isnot [bool]) { Add-E2eSlowWait $sw.ElapsedMilliseconds $TimeoutMs; return $value }
        if ($value -is [bool] -and $value) { Add-E2eSlowWait $sw.ElapsedMilliseconds $TimeoutMs; return $true }
        if (-not $sw.IsRunning) { $sw.Start() } elseif ($sw.ElapsedMilliseconds -ge $TimeoutMs) { return $null }
        Wait-Pump $EveryMs
    }
}

# Notes a wait of a run that was met, but only after two thirds of its limit: how long it took, its
# limit, the case, and where in the cases and the harness it was asked for. A case's time in the log is
# one number for all its waits; this says which wait a slower machine would fail on, before it does.
# Limits under a second are left out: they are the steps of a longer wait.
function Add-E2eSlowWait {
    param([long]$Ms, [int]$TimeoutMs)
    if ($null -eq $script:E2eRun -or $TimeoutMs -lt 1000 -or $Ms * 3 -lt $TimeoutMs * 2) { return }
    $where = @(Get-PSCallStack | Select-Object -Skip 2 | Where-Object { $_.ScriptName -like '*EndToEnd*.ps1' } | Select-Object -First 3 | ForEach-Object { "$(Split-Path $_.ScriptName -Leaf):$($_.ScriptLineNumber)" })
    $script:E2eRun.SlowWaits.Add("$($script:E2eRun.Case): $Ms ms of $TimeoutMs ms at $($where -join ', called from ')")
}

# ---------------------------------------------------------------------------------------------------
# Keys and the mouse, through SendInput from this process.

function Send-E2eKey {
    param([Parameter(Mandatory)][int]$Vk, [switch]$Up)
    if ([OmbE2e.Input]::Key($Vk, [bool]$Up, (Test-ExtendedKey $Vk)) -ne 1) { throw "SendInput refused the key vk $('{0:X2}' -f $Vk)" }
}

# Taps one key: down, a moment, up (the up also when the wait is cut short).
function Send-E2eTap {
    param([Parameter(Mandatory)][int]$Vk, [int]$HoldMs = 40)
    Send-E2eKey $Vk
    try { Wait-Pump $HoldMs } finally { Send-E2eKey $Vk -Up }
}

# Presses the keys of a chord such as 'Ctrl+Shift+t' (the library's names) from this process.
function Send-E2eChord {
    param([Parameter(Mandatory)][string]$Chord)
    try {
        foreach ($e in (ConvertTo-KeyEvent $Chord)) { Send-E2eKey $e.Vk -Up:([bool]$e.Up); Wait-Pump 15 }
    } finally { Clear-E2eHeldKeys }
}

# Clicks at a point of the screen. The button is held until Until (a condition, as Wait-E2eCondition
# takes it) holds, at most TimeoutMs, and is let go however that ends: a program that looks for a held
# button now and then (the delayed-click form does, every 10 ms) may miss a press that lasts a fixed
# moment when the machine is slow. Without Until it is held for a moment.
function Send-E2eClick {
    param([int]$X, [int]$Y, [ValidateSet('Left', 'Right')][string]$Button = 'Left', [scriptblock]$Until, [int]$TimeoutMs = 3000)
    [void][OmbE2e.Input]::MoveMouse($X, $Y)
    Wait-Pump 30
    $flags = @{ Left = @(2, 4); Right = @(8, 16) }[$Button]
    [void][OmbE2e.Input]::Mouse($flags[0])
    try { if ($Until) { [void](Wait-E2eCondition $Until -TimeoutMs $TimeoutMs) } else { Wait-Pump 30 } }
    finally { [void][OmbE2e.Input]::Mouse($flags[1]) }
}

# Puts the pointer at a point of the screen (the units SetCursorPos and GetWindowRect use in this
# process), and throws when it is not there afterwards: Windows keeps the pointer on the screen, and
# inside a clipping rectangle a program may have set.
function Move-E2ePointer {
    param([int]$X, [int]$Y)
    [void][OmbE2e.Input]::MoveMouse($X, $Y)
    $at = [OmbE2e.Input]::MousePosition()
    if ($at[0] -ne $X -or $at[1] -ne $Y) { throw "The pointer could not be put at ($X, $Y); it is at ($($at -join ', '))." }
}

# Lets go of Shift, Ctrl, Alt, the Windows keys and Fn where Windows says one is still down, so that a
# run that stopped in the middle of a chord leaves no key held for the person or the next build.
function Clear-E2eHeldKeys {
    foreach ($vk in $script:E2eHoldableVk) {
        if (([Macropad.Native]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { [void][OmbE2e.Input]::Key($vk, $true, (Test-ExtendedKey $vk)) }
    }
}

# True when the window that has the keyboard is one a check may wait behind: a window of a process the
# run started (a stand-in, the macropad under test), a window the run recorded as opened by a case's own
# key, or no window at all (the keyboard is on its way from one window to the next). Any other window is
# a person's or another program's.
function Test-E2eOwnFront {
    param([IntPtr]$Hwnd)
    if ($Hwnd -eq [IntPtr]::Zero) { return $true }
    if ($null -eq $script:E2eRun) { return $false }
    if ($script:E2eRun.Windows -contains $Hwnd) { return $true }
    $ours = @($script:E2eRun.Processes | ForEach-Object { $_.Pid })
    if ($null -ne $script:E2eRun.Macropad) { $ours += $script:E2eRun.Macropad.Process.Id }
    $ours -contains (Get-WindowInfo $Hwnd).Pid
}

# Waits for the window a key is about to be pressed into to be the one in front (with -Desktop: the
# desktop itself). '' when it is, else what to say. The keyboard reaches a window a little after the
# state a case waited for, and later on a slow machine: after Show Desktop the windows are minimized
# before the desktop has the keyboard, and for that moment the window that was active still has it. So
# while what is in front is the test's own (Test-E2eOwnFront), this waits for the expected window, for
# up to E2eFrontMs. A window that is not the test's ends the wait at once: nothing is pressed into it,
# nothing is taken back from it, and nothing waits for a person to go away. A wait that was needed is
# said in the log, with what had the keyboard and for how long: that is how often, and by how much, a
# machine is late.
function Wait-E2eFront {
    param([IntPtr]$Hwnd, [string]$What = 'the window the case made active', [switch]$Desktop)
    $first = @{}
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $seen = Wait-E2eCondition {
        $fg = [Macropad.WindowApi]::Foreground()
        if ($Desktop) { if (Test-E2eDesktopFront) { return 'front' } } elseif ($fg -eq $Hwnd) { return 'front' }
        if (-not (Test-E2eOwnFront $fg)) { return 'other' }
        if (-not $first.Text) { $first.Text = Get-E2eForegroundText }
    } -TimeoutMs $script:E2eFrontMs -EveryMs 15
    if ($seen -eq 'front') {
        if ($first.Text) { Write-Host "End-to-end: $What was not in front yet when a key was to be pressed; $($first.Text) still had the keyboard. It came in front $($sw.ElapsedMilliseconds) ms later, and the key was pressed then." }
        return ''
    }
    $waited = if ($seen) { '' } else { " It was waited for for $($script:E2eFrontMs) ms, while a window of the test's own had the keyboard." }
    "Not pressed: $What was not in front; $(Get-E2eForegroundText) was.$waited"
}

# Before a key is pressed into a window: that window must be the one in front (Wait-E2eFront). Nothing
# is pressed when it is not; the error says what was in front.
function Assert-E2eFront {
    param([IntPtr]$Hwnd, [string]$What = 'the window the case made active')
    $why = Wait-E2eFront $Hwnd $What
    if ($why) { throw $why }
}

# Under -Ci only (OMB_E2E_CI: nobody sits at that desktop), Windows' own shell may have come up by
# itself a moment after a case (Snap Assist after a snap, the desktop after a desktop switch) and taken
# the keyboard. Once, such a window of explorer.exe is put away (Escape, only while that overlay is in
# front) and Front is brought back, paced. On a developer's desktop nothing is taken back from a
# person: nothing happens here, and the press is refused, saying what was in front. True when it did
# something.
function Restore-E2eFront {
    param([IntPtr]$Front)
    if ($env:OMB_E2E_CI -ne '1') { return $false }
    $fg = [Macropad.WindowApi]::Foreground()
    if ($fg -eq $Front) { return $false }
    $info = Get-WindowInfo $fg
    if ($info.Exe -ne 'explorer.exe' -or $info.Class -notin $script:E2eShellClasses) { return $false }
    Write-Host "End-to-end (CI): $(Get-E2eForegroundText) had the keyboard; it is put away once and the case's window brought back."
    if ($info.Class -eq 'XamlExplorerHostIslandWindow') {
        Wait-ScreenChange
        [void](Send-E2eChordTo $fg 'Escape')
        [void](Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -ne $fg } -TimeoutMs 1500)
    }
    [void](Set-E2eActive $Front)
    $true
}

# True when the desktop itself (or the taskbar) has the keyboard, or no window has: where a key that
# shows the desktop or switches virtual desktops leaves it.
function Test-E2eDesktopFront {
    $fg = [Macropad.WindowApi]::Foreground()
    if ($fg -eq [IntPtr]::Zero) { return $true }
    $info = Get-WindowInfo $fg
    $info.Exe -eq 'explorer.exe' -and $info.Class -in $script:E2eDesktopClasses
}

# Presses a case's macro key: paced, and only while the window the case names (Front) is in front.
# With -FrontDesktop, the case names the desktop itself (after Show Desktop, or on a new virtual
# desktop), and the desktop must have the keyboard. With neither, nothing is pressed: the window a key
# goes into is never taken from whatever happens to be in front. The window is waited for while one of
# the test's own still has the keyboard (Wait-E2eFront); only after that wait is Windows' own shell put
# away, under -Ci (Restore-E2eFront).
function Invoke-E2eCaseKey {
    param($ctx, [IntPtr]$Front = $ctx.Front, [int]$Slot = $ctx.Case.Slot, [switch]$FrontDesktop)
    Wait-ScreenChange
    if ($FrontDesktop) {
        $why = Wait-E2eFront -Desktop -What 'the desktop'
    } else {
        if ($Front -eq [IntPtr]::Zero) { throw 'Not pressed: the case names no window to press into (no known front).' }
        $why = Wait-E2eFront $Front
        if ($why -and (Restore-E2eFront $Front)) {
            Wait-ScreenChange  # the restore changed the screen; the press may change it again
            $why = Wait-E2eFront $Front
        }
    }
    if ($why) { throw $why }
    $ctx.Pressed = $true
    # For the account of a failure (Get-E2eFailureState) and the timing of NextWindow (Get-E2eChordTimes):
    # the window in front when the key went down, and when, on the key watch's clock.
    $ctx.PressFront = [Macropad.WindowApi]::Foreground()
    $ctx.PressMs = [OmbE2e.KeyWatch]::Now()
    Invoke-E2eMacroKey $Slot
}

# Types a chord into Hwnd, only while it is in front.
function Send-E2eChordTo {
    param([IntPtr]$Hwnd, [string]$Chord)
    Assert-E2eFront $Hwnd
    Send-E2eChord $Chord
}

# ---------------------------------------------------------------------------------------------------
# The state file (what the run started, opened and stopped) and the banner, which is also the watchdog.

function Write-E2eState {
    $r = $script:E2eRun
    $lines = [System.Collections.Generic.List[string]]::new()
    # What makes each line the run's own: the test process with its start time, the start of Windows,
    # each process with its start time, each window with its process and class, each desktop by its id.
    $lines.Add("test $PID $(Get-E2eStartTicks $PID)")
    $lines.Add("boot $($r.Boot)")
    if ($r.CleanupStarted) { $lines.Add('cleanup') }
    if ($r.BannerPid) { $lines.Add("banner $($r.BannerPid) $($r.BannerStart)") }
    foreach ($p in $r.Processes) { $lines.Add("kill $($p.Pid) $($p.Start) $($p.Name)") }
    # A window that no longer exists (a closed one that its program kept, hidden, for a while) leaves the list.
    foreach ($h in @($r.Windows)) { if (-not [Macropad.WindowApi]::Exists($h)) { [void]$r.Windows.Remove($h) } }
    foreach ($h in $r.Windows) { $i = $r.WindowInfo[[long]$h]; if ($i) { $lines.Add("window $([long]$h) $($i.Pid) $($i.Start) $($i.Class)") } }
    foreach ($d in $r.NewDesktops) { $lines.Add("desktop $d") }
    foreach ($o in $r.Owners) { $lines.Add("run $($o.Exe)`t$($o.Arguments)`t$($o.Cwd)") }
    [System.IO.File]::WriteAllLines($r.StateFile, [string[]]$lines)
}

# When a process started (UTC ticks), or 0 when it is gone or cannot be read: with its pid, this says
# whether a process is still the one a run started.
function Get-E2eStartTicks {
    param([int]$Id)
    try { (Get-Process -Id $Id -ErrorAction Stop).StartTime.ToUniversalTime().Ticks } catch { 0 }
}

# When Windows last started (UTC ticks): a state file from before that names nothing that still exists.
function Get-E2eBootTicks {
    (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().Ticks
}

# How many times a case that repeats a moment runs it (the Calculator series): OMB_E2E_REPEAT
# (run.ps1 -Repeat), else 2.
function Get-E2eRepeat {
    if ($env:OMB_E2E_REPEAT -match '^\d+$' -and [int]$env:OMB_E2E_REPEAT -gt 0) { return [int]$env:OMB_E2E_REPEAT }
    2
}

# Starts a program for the run and remembers it, so that the clean-up ends it (Clear-E2eLeftovers, at
# the run's end or after a run that did not end itself). Environment entries are added to this process's
# own, minus the test's own variables; this process's own environment is never changed.
function Start-E2eProcess {
    param([Parameter(Mandatory)][string]$File, [string]$Arguments = '', [hashtable]$Environment = @{}, [string]$WorkingDirectory = '', [switch]$NoTrack)
    $si = [System.Diagnostics.ProcessStartInfo]::new($File, $Arguments)
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    if ($WorkingDirectory) { $si.WorkingDirectory = $WorkingDirectory }
    foreach ($k in $script:E2eOwnVariables) { [void]$si.EnvironmentVariables.Remove($k) }
    foreach ($k in $Environment.Keys) { $si.EnvironmentVariables[$k] = [string]$Environment[$k] }
    $p = [System.Diagnostics.Process]::Start($si)
    # The start time of a process just started can always be read while it runs: none means that it has
    # already ended, and then there is nothing to end later and nothing to record.
    $start = Get-E2eStartTicks $p.Id
    if (-not $NoTrack -and $start -ne 0) {
        $script:E2eRun.Processes.Add([pscustomobject]@{ Pid = $p.Id; Name = [System.IO.Path]::GetFileName($File); Start = $start })
        Write-E2eState
    }
    $p
}

function Stop-E2eProcessId {
    param([int]$Id)
    $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
    if ($p) {
        Stop-Process -Id $Id -Force -ErrorAction SilentlyContinue
        [void]$p.WaitForExit(5000)
    }
    $remaining = @($script:E2eRun.Processes | Where-Object { $_.Pid -ne $Id })
    $script:E2eRun.Processes.Clear()
    foreach ($r in $remaining) { $script:E2eRun.Processes.Add($r) }
    Write-E2eState
}

# Shows the banner, which watches this process, and waits the three seconds it is up before the first
# key or change of the screen; its process id. For a run (Run), it has the run's state file and time
# limit and is recorded in the state; a clean-up that changes the screen with no banner up shows one
# without either. It is started so that a Jenkins abort, which ends the build's process tree, does not
# end it (Jenkins finds that tree by BUILD_ID and JENKINS_NODE_COOKIE): when this process is gone it
# starts the clean-up (run.ps1 -EndToEndCleanup), which then runs outside the tree too.
function Start-E2eBanner {
    param($Run)
    Wait-ScreenChange
    $state = ''; $deadline = 0
    if ($null -ne $Run) { $state = $Run.StateFile; $deadline = [long]($Run.Deadline - [DateTime]'1970-01-01').TotalSeconds }
    $arguments = '"{0}" {1} "{2}" {3}' -f (Join-Path $script:E2eFixtures 'banner.ahk'), $PID, $state, $deadline
    # Detached, so that it holds none of this process's handles (a build step's output pipe stays open
    # while any process holds it).
    $environment = @(foreach ($e in [Environment]::GetEnvironmentVariables().GetEnumerator()) {
            if ($e.Key -notin ($script:E2eOwnVariables + 'BUILD_ID', 'JENKINS_NODE_COOKIE')) { "$($e.Key)=$($e.Value)" }
        }) + @('BUILD_ID=dontKillMe', 'JENKINS_NODE_COOKIE=dontKillMe') | Sort-Object
    $bannerPid = [OmbE2e.ProcessInfo]::StartDetached((Get-AhkExe), $arguments, '', [string[]]$environment)
    if ($bannerPid -eq 0) { throw 'The banner could not be started.' }
    if ($null -ne $Run) {
        $Run.BannerPid = $bannerPid
        $Run.BannerStart = Get-E2eStartTicks $bannerPid
        Write-E2eState
    }
    $window = Wait-E2eCondition { $w = Find-Window "$script:E2eBannerWindow ahk_pid $bannerPid"; if ($w -ne [IntPtr]::Zero) { $w } } -TimeoutMs 10000
    if ($null -eq $window) { throw 'The banner did not appear within 10 s.' }
    Wait-ScreenChange -Observed
    Wait-Pump 3000
    $bannerPid
}

# ---------------------------------------------------------------------------------------------------
# Macropads that run before the run (a person's): either language, started from anywhere.

# The text that follows the program on a command line. Exe, the program's full path, may stand there
# unquoted with spaces in it (C:\Program Files\...), which is then taken whole.
function Get-E2eCommandArguments {
    param([string]$CommandLine, [string]$Exe = '')
    $line = $CommandLine.TrimStart()
    if ($line.StartsWith('"')) { $end = $line.IndexOf('"', 1); if ($end -lt 0) { return '' }; return $line.Substring($end + 1).Trim() }
    if ($Exe -and $line.StartsWith($Exe, [StringComparison]::OrdinalIgnoreCase) -and ($line.Length -eq $Exe.Length -or $line[$Exe.Length] -eq ' ')) {
        return $line.Substring($Exe.Length).Trim()
    }
    $space = $line.IndexOf(' ')
    if ($space -lt 0) { return '' }
    $line.Substring($space + 1).Trim()
}

# The arguments of a command line, one by one, with their quotes taken off.
function Split-E2eArguments {
    param([string]$Text)
    , @(foreach ($m in [regex]::Matches($Text, '"([^"]*)"|(\S+)')) { if ($m.Groups[1].Success) { $m.Groups[1].Value } else { $m.Groups[2].Value } })
}

# What a process runs when it is a macropad: @{ Lang; Script } (the script's full path), or $null. A
# macropad is the interpreter with the macropad's script as its argument: AutoHotkey with a main.ahk
# that has config.ahk and lib beside it (not loaded with /Validate or /iLib, which only read it), or
# powershell.exe with -File and a main.ps1 that has lib\ConfigJson.ps1 beside it. A relative script
# path is read from Cwd, the process's working directory.
function Get-E2eMacropadScript {
    param([string]$Name, [string]$Arguments, [string]$Cwd = '')
    $words = Split-E2eArguments $Arguments
    $script = $null; $lang = $null
    if ($Name -like 'autohotkey*') {
        for ($i = 0; $i -lt $words.Count; $i++) {
            $w = $words[$i]
            if ($w -match '^/(validate|ilib)\b') { return $null }
            if ($w -match '^/include$') { $i++; continue }
            if ($w.StartsWith('/')) { continue }
            $script = $w; $lang = 'ahk'; break
        }
    } elseif ($Name -eq 'powershell.exe') {
        for ($i = 0; $i -lt $words.Count - 1; $i++) { if ($words[$i] -match '^-f(ile)?$') { $script = $words[$i + 1]; $lang = 'ps'; break } }
    }
    if (-not $script) { return $null }
    if (-not [System.IO.Path]::IsPathRooted($script)) { if (-not $Cwd) { return $null }; $script = Join-Path $Cwd $script }
    try { $script = [System.IO.Path]::GetFullPath($script) } catch { return $null }
    $dir = Split-Path $script -Parent
    $leaf = Split-Path $script -Leaf
    if ($lang -eq 'ahk' -and $leaf -eq 'main.ahk' -and (Test-Path -LiteralPath (Join-Path $dir 'config.ahk')) -and (Test-Path -LiteralPath (Join-Path $dir 'lib') -PathType Container)) { return @{ Lang = 'ahk'; Script = $script } }
    if ($lang -eq 'ps' -and $leaf -eq 'main.ps1' -and (Test-Path -LiteralPath (Join-Path $dir 'lib\ConfigJson.ps1'))) { return @{ Lang = 'ps'; Script = $script } }
    $null
}

# The macropads among the processes: rows with Lang, Script, Pid, Exe, CommandLine, Arguments, Cwd.
# The run's own macropads (their script is in a run folder, omb-e2e-...) and the processes in Ignore do
# not count. $Processes are Win32_Process rows.
function Find-E2eMacropads {
    param([object[]]$Processes, [int[]]$Ignore = @())
    , @(foreach ($p in @($Processes)) {
            if (-not $p.CommandLine -or $Ignore -contains [int]$p.ProcessId) { continue }
            $arguments = Get-E2eCommandArguments $p.CommandLine $p.ExecutablePath
            $cwd = [OmbE2e.ProcessInfo]::CurrentDirectory([int]$p.ProcessId)
            if (-not $cwd) { $cwd = '' }  # unreadable: a relative script cannot be found, and it starts in this process's folder
            $found = Get-E2eMacropadScript $p.Name $arguments $cwd
            if (-not $found -or $found.Script -match '\\omb-e2e-\d+(-\d+)?\\') { continue }
            [pscustomobject]@{ Lang = $found.Lang; Script = $found.Script; Pid = [int]$p.ProcessId; Exe = $p.ExecutablePath; CommandLine = $p.CommandLine; Arguments = $arguments; Cwd = $cwd }
        })
}

function Get-E2eMacropadProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name LIKE 'AutoHotkey%' OR Name = 'powershell.exe'" | Select-Object Name, ProcessId, ExecutablePath, CommandLine)
}

# Stops every macropad that runs, of either language, and records how to start each again: its program,
# its arguments and its working directory.
function Stop-E2eOwnerMacropads {
    foreach ($found in (Find-E2eMacropads (Get-E2eMacropadProcesses))) {
        $script:E2eRun.Owners.Add($found)
        Write-E2eState
        Write-Host "End-to-end: stopping the running $($found.Lang) macropad (pid $($found.Pid)); it is started again at the end as it was: $($found.CommandLine) (in $($found.Cwd))"
        if ($found.Lang -eq 'ahk') {
            $main = Find-Window "ahk_class AutoHotkey ahk_pid $($found.Pid)" -IncludeHidden
            if ($main -ne [IntPtr]::Zero) { [void][Macropad.WindowApi]::Post($main, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
        } else {
            Stop-Process -Id $found.Pid -Force -ErrorAction SilentlyContinue
        }
        $gone = Wait-E2eCondition { -not (Get-Process -Id $found.Pid -ErrorAction SilentlyContinue) } -TimeoutMs 5000
        if (-not $gone) { Stop-Process -Id $found.Pid -Force -ErrorAction SilentlyContinue }
    }
}

# The environment a macropad the test stopped is started again with: this process's own, less every
# variable of the macropad's and of the test's (OMB_CONFIG, OMB_E2E and the others, all OMB_...), which
# a person's macropad never had from the test, and less BUILD_ID and JENKINS_NODE_COOKIE when they are
# the banner's dontKillMe (the clean-up the banner starts has them).
function Get-E2eOwnerEnvironment {
    $all = @(foreach ($e in [Environment]::GetEnvironmentVariables().GetEnumerator()) {
            $key = [string]$e.Key
            if ($key.StartsWith('OMB_', [StringComparison]::OrdinalIgnoreCase)) { continue }
            if ($key -in 'BUILD_ID', 'JENKINS_NODE_COOKIE' -and $e.Value -eq 'dontKillMe') { continue }
            "$key=$($e.Value)"
        })
    , [string[]]@($all | Sort-Object)
}

# Starts one recorded macropad again, from its program, arguments and working directory, unless a
# macropad of the same script already runs: it is started at most once, by whoever comes first. 'ran'
# when one already ran, 'started' when this started it, 'failed' when it could not.
function Start-E2eRecordedMacropad {
    param([string]$Exe, [string]$Arguments, [string]$Cwd)
    $wanted = Get-E2eMacropadScript ([System.IO.Path]::GetFileName($Exe)) $Arguments $Cwd
    $running = {
        foreach ($m in (Find-E2eMacropads (Get-E2eMacropadProcesses))) {
            if ($wanted) { if ($m.Lang -eq $wanted.Lang -and $m.Script -eq $wanted.Script) { return $true } }
            elseif ($m.Exe -eq $Exe -and $m.Arguments -eq $Arguments) { return $true }
        }
        $false
    }
    if (& $running) { return 'ran' }
    # Detached: it holds none of this process's handles (a run's output pipe would otherwise stay open
    # until the macropad exits).
    $dir = if ($Cwd -and (Test-Path -LiteralPath $Cwd)) { $Cwd } else { '' }
    if ([OmbE2e.ProcessInfo]::StartDetached($Exe, $Arguments, $dir, (Get-E2eOwnerEnvironment)) -eq 0) { return 'failed' }
    if (Wait-E2eCondition $running -TimeoutMs 20000) { 'started' } else { 'failed' }
}

# ---------------------------------------------------------------------------------------------------
# The run: its folder, the copy of the macropad it starts, the program stand-ins, and its end.

function New-E2eRun {
    param([int]$LimitMinutes = 20)
    $dir = Join-Path ([OmbE2e.ProcessInfo]::LongPath([System.IO.Path]::GetTempPath())) "omb-e2e-$PID"
    # A folder of an earlier process that had this pid is a leftover: it is moved aside, unread, for
    # Clear-E2eLeftovers to carry out.
    if (Test-Path -LiteralPath $dir) { Rename-Item -LiteralPath $dir -NewName "omb-e2e-$PID-$([DateTime]::UtcNow.Ticks)" }
    foreach ($sub in 'bin', 'path', 'temp', 'E2E Test', 'app') { [void](New-Item -ItemType Directory -Path (Join-Path $dir $sub)) }
    # From here on the test works in the run's folder, and so does whatever it starts without saying
    # where. Nothing of a run works in the folder the test was called from (a checkout, a Jenkins
    # workspace): a program that outlives the run can then keep only the run's folder, which the
    # clean-up handles, never the workspace of the next build.
    Set-Location -LiteralPath $dir
    [Environment]::CurrentDirectory = $dir
    $script:E2eRun = [pscustomobject]@{
        Dir          = $dir
        LimitMinutes = $LimitMinutes
        StartedAt    = [DateTime]::Now
        Deadline     = [DateTime]::UtcNow.AddMinutes($LimitMinutes)
        StateFile    = Join-Path $dir 'state.txt'
        Processes    = [System.Collections.Generic.List[object]]::new()
        Owners       = [System.Collections.Generic.List[object]]::new()
        BannerPid    = $null
        BannerStart  = 0
        Standins     = @{}
        Macropad     = $null
        Windows      = [System.Collections.Generic.List[IntPtr]]::new()
        DesktopCount = $null
        NewDesktops  = [System.Collections.Generic.List[string]]::new()
        WindowInfo   = @{}
        Boot         = Get-E2eBootTicks
        CleanupStarted = $false
        LastActivated = [IntPtr]::Zero
        NotRun       = [System.Collections.Generic.List[string]]::new()
        Case         = ''
        SlowWaits    = [System.Collections.Generic.List[string]]::new()
        Chunks       = 1
    }
    Write-E2eState
    $script:E2eRun
}

# A copy of the macropad's tracked folders (ahk without its tests, powershell's program, lib and
# commands, img, config.json) in the run's folder: the macropads under test start from it, so they never
# load the person's own commands from local/, which is not copied.
function Install-E2eApp {
    $app = Join-Path $script:E2eRun.Dir 'app'
    foreach ($d in 'ahk', 'powershell') { [void](New-Item -ItemType Directory -Path (Join-Path $app $d)) }
    foreach ($item in Get-ChildItem -LiteralPath (Join-Path $script:E2eRepo 'ahk') | Where-Object { $_.Name -ne 'tests' }) { Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $app 'ahk') -Recurse }
    foreach ($name in 'main.ps1', 'config.ps1', 'launch.vbs', 'lib', 'commands') { Copy-Item -LiteralPath (Join-Path $script:E2eRepo "powershell\$name") -Destination (Join-Path $app 'powershell') -Recurse }
    Copy-Item -LiteralPath (Join-Path $script:E2eRepo 'img') -Destination $app -Recurse
    Copy-Item -LiteralPath (Join-Path $script:E2eRepo 'config.json') -Destination $app
    # The PowerShell macropad's loader: the test's own commands, then main.ps1, run with -File as
    # launch.vbs runs main.ps1. Each path is a single-quoted string, with ' written twice.
    $quote = { param($p) "'" + $p.Replace("'", "''") + "'" }
    $loader = @(". $(& $quote (Join-Path $script:E2eFixtures 'commands.ps1'))", ". $(& $quote (Join-Path $app 'powershell\main.ps1'))")
    [System.IO.File]::WriteAllLines((Join-Path $script:E2eRun.Dir 'start-ps.ps1'), [string[]]$loader)
}

# A copy of AutoHotkey named Exe in the run's bin folder, for stand-ins that must belong to a process
# of that name.
function Get-E2eAhkCopy {
    param([Parameter(Mandatory)][string]$Exe)
    $copy = Join-Path $script:E2eRun.Dir "bin\$Exe"
    if (-not (Test-Path -LiteralPath $copy)) { Copy-Item -LiteralPath (Get-AhkExe) -Destination $copy }
    $copy
}

# The launcher (ahk\tests\e2e\launcher.cs) under each of these names in the run's path folder, which
# the macropad finds first on its PATH, and as 'E2E Test\e2e app.exe' (a path with spaces). It records
# what it was started with and shows no window: the stand-ins that are there for the whole run (A as
# chrome.exe, P as putty.exe, B and C as e2eapp.exe) are the windows the commands bring forward, so no
# window opens and closes per case.
function Install-E2eLaunchers {
    param([string[]]$Names = @('chrome.exe', 'putty.exe', 'ssh.exe', 'e2eapp.exe'))
    $built = Join-Path $script:E2eRun.Dir 'launcher.exe'
    Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $script:E2eFixtures 'launcher.cs') -Raw) -OutputAssembly $built -OutputType WindowsApplication
    foreach ($n in $Names) {
        Copy-Item -LiteralPath $built -Destination (Join-Path $script:E2eRun.Dir "path\$n")
        [void](Get-E2eAhkCopy $n)
    }
    Copy-Item -LiteralPath $built -Destination (Join-Path $script:E2eRun.Dir 'E2E Test\e2e app.exe')
}

# The scripts the script helpers run, in a folder with a space in its name, and the folders and files
# the cases open.
function Install-E2eScripts {
    $dir = Join-Path $script:E2eRun.Dir 'E2E Test'
    foreach ($f in 'write.py', 'write.ps1', 'args.bat') { Copy-Item -LiteralPath (Join-Path $script:E2eFixtures $f) -Destination $dir }
    [void](New-Item -ItemType Directory -Path (Join-Path $dir 'Smith, John'))
    Set-Content -LiteralPath (Join-Path $dir 'note a.txt') -Value 'end-to-end test'
}

# The programs the launcher recorded after Mark: Exe (its full path), Parent (the name of the process
# that started it) and Arguments (what followed the program on its command line).
function Get-E2eLaunches {
    param([int]$Mark = 0)
    $lines = @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'launches.log'))
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
        $p = $lines[$i] -split "`t", 3
        [pscustomobject]@{ Exe = $p[0]; Parent = $p[1]; Arguments = (Get-E2eCommandArguments $p[2]) }
    }
}

function Get-E2eLaunchMark { @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'launches.log')).Count }

# The working directory of a process, or $null when it cannot be read (ProcessInfo.CurrentDirectory).
# A function of its own, so that the tests of the clean-up can give one without a real process.
function Get-E2eWorkingDirectory {
    param([int]$Id)
    [OmbE2e.ProcessInfo]::CurrentDirectory($Id)
}

# The processes that are in a folder: those that run from it (in a run's folder: stand-ins, copies of
# AutoHotkey, the launcher) and, with -OrWorkingIn, those whose working directory is in it. The test
# and the macropads under test work in the run's folder, and a program one of them starts inherits
# that, so a program that outlives its window is found there, and keeps the folder from being removed
# until it has ended. With -OrWorkingIn, which every clean-up uses, this process and the ones it
# descends from never count (a clean-up called from a shell that stands in the folder; the steps of a
# build). Each row has WorkingIn (that directory, or ''
# for a process that runs from the folder) and StartTicks (when it started, in UTC ticks; 0 when that
# cannot be read): where a process is and when it started say whose it is.
function Get-E2eRunProcesses {
    param([string]$Dir = $script:E2eRun.Dir, [switch]$OrWorkingIn)
    $prefix = $Dir.TrimEnd('\') + '\'
    $all = @(Get-CimInstance Win32_Process)
    $row = {
        param($p, [string]$where)
        $start = 0L
        if ($p.CreationDate) { $start = $p.CreationDate.ToUniversalTime().Ticks }
        $p | Add-Member WorkingIn $where -Force
        $p | Add-Member StartTicks $start -Force -PassThru
    }
    $from = @($all | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { & $row $_ '' })
    if (-not $OrWorkingIn) { return $from }
    $mine = @($PID)
    for ($i = 0; $i -lt 20; $i++) {
        $parent = @($all | Where-Object { [int]$_.ProcessId -eq $mine[-1] })[0]
        if (-not $parent -or $mine -contains [int]$parent.ParentProcessId) { break }
        $mine += [int]$parent.ParentProcessId
    }
    @($from | Where-Object { $mine -notcontains [int]$_.ProcessId }) + @(foreach ($p in $all) {
            if ($from -contains $p -or $mine -contains [int]$p.ProcessId) { continue }
            $cwd = Get-E2eWorkingDirectory ([int]$p.ProcessId)
            if ($cwd -and ($cwd.TrimEnd('\') + '\').StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { & $row $p $cwd }
        })
}

# One row of Get-E2eRunProcesses, with all that says what it is and what started it: a log is then
# enough to tell which case left it.
function Get-E2eProcessText {
    param($Process)
    $when = if ($Process.StartTicks) { ([DateTime]::new($Process.StartTicks, [DateTimeKind]::Utc)).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss') } else { 'at a time that cannot be read' }
    $where = if ($Process.WorkingIn) { "working in $($Process.WorkingIn)" } else { "running from $($Process.ExecutablePath)" }
    "$($Process.Name) $($Process.ProcessId) (started $when by process $($Process.ParentProcessId), $where, command line: $($Process.CommandLine))"
}

# ---------------------------------------------------------------------------------------------------
# Windows that commands open.

# The windows that fit one entry of a case's WinTitle list: a WinTitle as Find-Window reads it, or
# 'app:<application id>' for the frame windows of a Store app (Settings, Calculator), whose titles are
# translated and whose application id is the same in every display language.
function Find-E2eWindows {
    param([string]$WinTitle, [switch]$IncludeHidden)
    if ($WinTitle -notlike 'app:*') { return , (Find-Window $WinTitle -All -IncludeHidden:$IncludeHidden) }
    # Read straight from Windows, topmost first, and nothing but the class, the visibility and the id: a
    # case that must press while a frame is still cloaked looks many times a second, on a slow machine too.
    , [IntPtr[]]@(foreach ($h in [Macropad.WindowApi]::TopLevel()) {
            if ([Macropad.WindowApi]::ClassName($h) -ceq 'ApplicationFrameWindow' -and ($IncludeHidden -or [Macropad.WindowApi]::Visible($h)) -and (Get-WindowAppId $h) -eq $WinTitle.Substring(4)) { $h }
        })
}

# The visible windows that fit any of the WinTitles (Find-E2eWindows' forms), as a list of handles. A
# cloaked window (Windows keeps it off the screen: a Store app's frame while the app starts, a window
# on another virtual desktop) is left out unless IncludeCloaked says otherwise.
function Get-E2eWindows {
    param([string[]]$WinTitle, [switch]$IncludeCloaked, [switch]$IncludeHidden)
    $seen = [System.Collections.Generic.List[IntPtr]]::new()
    foreach ($t in $WinTitle) { foreach ($h in (Find-E2eWindows $t -IncludeHidden:$IncludeHidden)) { if (-not $seen.Contains($h) -and ($IncludeCloaked -or -not [OmbE2e.Dwm]::Cloaked($h))) { $seen.Add($h) } } }
    , $seen.ToArray()
}

# The windows of the WinTitles that the run did not open (a person's own, or an aborted run's), as
# descriptions: those the command under test could pick itself. Both languages' helpers search as
# Find-Window does without -IncludeHidden (AutoHotkey's WinExist with hidden windows not detected):
# visible windows, cloaked ones among them, never hidden ones, such as a Jenkins agent's own hidden
# console. -IncludeHidden is for a command whose program Windows brings back from a hidden window
# (Settings, a Store app that hides its window while it is suspended).
function Get-E2eForeignWindows {
    param([string[]]$WinTitle, [switch]$IncludeHidden)
    $ours = @($script:E2eRun.Processes | ForEach-Object { $_.Pid }) + @(Get-E2eRunProcesses | ForEach-Object { [int]$_.ProcessId })
    , @(foreach ($h in (Get-E2eWindows $WinTitle -IncludeCloaked -IncludeHidden:$IncludeHidden)) {
            if ($script:E2eRun.Windows -contains $h) { continue }
            $i = Get-WindowInfo $h
            if ($ours -notcontains $i.Pid) { "'$($i.Title)' ($($i.Exe))" }
        })
}

# The lines of marks.log (what the test's own commands write) after Mark.
function Get-E2eMarks {
    param([int]$Mark = 0)
    @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'marks.log') | Select-Object -Skip $Mark)
}

# ---------------------------------------------------------------------------------------------------
# The macropad's command log. A macropad the test starts (OMB_E2E and OMB_E2E_DIR set) appends to the
# run's commands.log a line when a command that a key or a click on the overlay runs starts, and one
# when it has returned or thrown, the same in both languages: 'start <command>', 'done <command>',
# 'failed <command>: <message>'. <command> is the function the layout names (RunMacroAction in
# ahk\lib\io.ahk, Invoke-EngineMacro in powershell\lib\Engine.ps1). A press the macropad did not take,
# or dropped while another command ran, writes nothing; a command that never returns writes only its
# start, and so does one that the macropad's exit ended. A case reads the lines written since its press
# (a mark: the number of lines before it).

function Get-E2eCommandLogPath { Join-Path $script:E2eRun.Dir 'commands.log' }

# How many lines the command log has now: read the lines after this mark.
function Get-E2eCommandMark { @(Read-E2eLog (Get-E2eCommandLogPath)).Count }

# The command log's lines after Mark.
function Get-E2eCommandLines {
    param([int]$Mark = 0)
    @(Read-E2eLog (Get-E2eCommandLogPath) | Select-Object -Skip $Mark)
}

# One line of the command log: Kind (start, done, failed), Command and Message (a failure's); $null for a
# line of another form.
function ConvertFrom-E2eCommandLine {
    param([string]$Line)
    if ($Line -match '^(start|done) (.+)$') { return [pscustomobject]@{ Kind = $Matches[1]; Command = $Matches[2]; Message = '' } }
    if ($Line -match '^failed (.+?): (.*)$') { return [pscustomobject]@{ Kind = 'failed'; Command = $Matches[1]; Message = $Matches[2] } }
    $null
}

# What the Run-th run of Command among Lines came to: State 'not started', 'running' (started, no end
# yet), 'done' or 'failed', and Message (a failure's). A run ends at the first end of the same command
# after its start: a command another key started meanwhile (AutoHotkey runs it in a thread that
# interrupts the first) ends in between. The same command never runs twice at once: AutoHotkey ignores
# a key whose press is still being handled, and the PowerShell macropad drops every key while a command
# runs.
function Get-E2eCommandState {
    param([string[]]$Lines, [string]$Command, [int]$Run = 1)
    $starts = 0
    $open = $false
    foreach ($line in @($Lines)) {
        $l = ConvertFrom-E2eCommandLine $line
        if ($null -eq $l -or $l.Command -ne $Command) { continue }
        if ($l.Kind -eq 'start') { $starts++; $open = $starts -eq $Run }
        elseif ($open) { return [pscustomobject]@{ State = $l.Kind; Message = $l.Message } }
    }
    $state = if ($starts -ge $Run) { 'running' } else { 'not started' }
    [pscustomobject]@{ State = $state; Message = '' }
}

# The failed lines among Lines (the command log after a case's press) that are the case's: those of its own
# Command and of E2eMark (the test's own key). The command an earlier case ran may end, and fail, after this
# case's mark: its line is that case's, not this one's.
function Get-E2eCaseFailedLines {
    param([string[]]$Lines, [string]$Command)
    @(foreach ($line in @($Lines)) {
            $l = ConvertFrom-E2eCommandLine $line
            if ($null -ne $l -and $l.Kind -eq 'failed' -and $l.Command -in @($Command, 'E2eMark')) { $line }
        })
}

# What a case's run left in the macropad's logs, checked after its own assertions (Invoke-E2eCase): no
# error the macropad reported after the first ErrorsBefore lines of its error logs, and no failure the
# macropad does not report (the AutoHotkey key handler drops an "Invalid index." error a command throws)
# in the command log after the press ($ctx.Commands): a failed line of the case's own command
# ($ctx.Case.Command) or of E2eMark, never one of an earlier case's command that ended after the mark.
# Throws (Should) at the first it finds.
function Assert-E2eCaseLogs {
    param($ctx, [int]$ErrorsBefore)
    $errors = @(Get-E2eErrorLines | Select-Object -Skip $ErrorsBefore)
    $errors -join "`n" | Should -BeNullOrEmpty -Because 'the macropad must not report an error'
    $failed = @(Get-E2eCaseFailedLines (Get-E2eCommandLines $ctx.Commands) $ctx.Case.Command)
    $failed -join "`n" | Should -BeNullOrEmpty -Because 'no command the case ran may fail (the macropad''s command log)'
}

# A state of Get-E2eCommandState in words, for a failure message, with the lines it was read from.
function Get-E2eCommandText {
    param($State, [string]$Command, [string[]]$Lines)
    $what = switch ($State.State) {
        'not started' { "the macropad never started $Command (it did not take the key, or dropped it while another command ran)" }
        'running' { "the macropad started $Command, and it has not finished" }
        'done' { "the macropad ran $Command to its end, so what is missing is what the command did, not its run" }
        default { "$Command failed: $($State.Message)" }
    }
    $all = @($Lines | Where-Object { $_ })
    $seen = if ($all.Count -gt 0) { $all -join ' / ' } else { 'nothing' }
    "$what (the command log since the press: $seen)"
}

# Waits, at most TimeoutMs, for the Run-th run of Command after Mark to end (done or failed). The state
# it came to (Get-E2eCommandState), with Lines: the log's lines after Mark, read after the wait.
function Wait-E2eCommand {
    param([int]$Mark, [string]$Command, [int]$Run = 1, [int]$TimeoutMs = 10000)
    [void](Wait-E2eCondition {
            $s = Get-E2eCommandState (Get-E2eCommandLines $Mark) $Command $Run
            if ($s.State -in 'done', 'failed') { $s }
        } -TimeoutMs $TimeoutMs)
    $lines = @(Get-E2eCommandLines $Mark)
    Get-E2eCommandState $lines $Command $Run | Add-Member Lines $lines -PassThru
}

# The command a press ran (Mark: the command log's length before the press) must have finished: its
# Run-th run after Mark ends with done within TimeoutMs. Throws otherwise, saying whether the macropad
# never started it, started it and it has not finished, or it failed. The state (Wait-E2eCommand).
function Assert-E2eCommandDone {
    param([int]$Mark, [string]$Command, [int]$Run = 1, [int]$TimeoutMs = 10000)
    $s = Wait-E2eCommand $Mark $Command $Run $TimeoutMs
    if ($s.State -ne 'done') { throw "Waited $TimeoutMs ms for $Command to finish: $(Get-E2eCommandText $s $Command $s.Lines)" }
    $s
}

# The message a case fails with: its failure, and, when the case pressed its key, what the command log
# says of the case's command since the press ($ctx.Commands), unless the failure says that already.
function Get-E2eFailureText {
    param([string]$Message, $ctx)
    if (-not $ctx.Pressed -or $Message -like '*(the command log since the press:*') { return $Message }
    try {
        $lines = @(Get-E2eCommandLines $ctx.Commands)
        $note = Get-E2eCommandText (Get-E2eCommandState $lines $ctx.Case.Command) $ctx.Case.Command $lines
    } catch { $note = "it could not be read: $($_.Exception.Message)" }
    "$Message`nWhat the macropad's command log says of $($ctx.Case.Command): $note"
}

# Waits for a window that fits a WinTitle, is not in Before and is on the screen (not cloaked); with
# -Active, until it is also the active window. Its handle, or $null. A found window is remembered, so
# that the run (or the leftover clean-up) closes it if the case does not.
function Wait-E2eNewWindow {
    param([string[]]$WinTitle, [IntPtr[]]$Before = @(), [switch]$Active, [int]$TimeoutMs = 8000)
    $h = Wait-E2eCondition {
        foreach ($w in (Get-E2eWindows $WinTitle)) {
            if ($Before -contains $w) { continue }
            if (-not $Active -or [Macropad.WindowApi]::Foreground() -eq $w) { return $w }
        }
    } -TimeoutMs $TimeoutMs
    if ($null -ne $h) {
        Wait-ScreenChange -Observed
        Add-E2eRunWindow $h
    }
    $h
}

# Remembers a window a command opened, with what makes it the same window later (its process, that
# process's start, its class), so that the run, or the clean-up after it, closes it.
function Add-E2eRunWindow {
    param([IntPtr]$Hwnd)
    if ($script:E2eRun.Windows -contains $Hwnd) { return }
    $windowPid = [Macropad.WindowApi]::ProcessId($Hwnd)
    $script:E2eRun.WindowInfo[[long]$Hwnd] = [pscustomobject]@{ Pid = $windowPid; Start = (Get-E2eStartTicks $windowPid); Class = [Macropad.WindowApi]::ClassName($Hwnd) }
    $script:E2eRun.Windows.Add($Hwnd)
    Write-E2eState
}

# Closes a window (paced), as its close button does: the one way the test closes a window and decides
# whether it is closed, during a run and in the clean-up after one. A window is closed when it is off
# the screen: it no longer exists, or its program keeps it, hidden (Calculator keeps a closed window
# for a fraction of a second, at times for half a minute, and the macropad's own forms hide when they
# are closed). That is a state, whatever time the program takes over the rest. A hidden window stays
# in the run's list for as long as it exists, so that it is closed again should it be shown again. This
# waits up to 10 s, and throws when the window is still on the screen, which leaves it in the run's
# list for the run's end, or the clean-up after it.
function Close-E2eWindow {
    param([IntPtr]$Hwnd)
    $shown = { [Macropad.WindowApi]::Exists($Hwnd) -and [Macropad.WindowApi]::Visible($Hwnd) }
    if (& $shown) {
        Wait-ScreenChange
        [void][Macropad.WindowApi]::Post($Hwnd, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)  # WM_CLOSE
        [void](Wait-E2eCondition { -not (& $shown) } -TimeoutMs 10000)
    }
    if (& $shown) {
        $i = Get-WindowInfo $Hwnd
        throw "The window $Hwnd ('$($i.Title)', $($i.Exe), class $($i.Class)) is still on the screen 10 s after it was closed."
    }
    if (-not [Macropad.WindowApi]::Exists($Hwnd) -and $null -ne $script:E2eRun -and $script:E2eRun.Windows.Remove($Hwnd)) { Write-E2eState }
}

function Test-E2eAdministrator {
    [bool](whoami /groups | Select-String -SimpleMatch 'S-1-5-32-544')
}

# ---------------------------------------------------------------------------------------------------
# Virtual desktops, through Windows' documented IVirtualDesktopManager and the desktop list Explorer
# keeps in the registry.

if (-not ('OmbE2e.Desktops' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace OmbE2e
{
    [ComImport, Guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IVirtualDesktopManager
    {
        [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr topLevelWindow, out int onCurrentDesktop);
        [PreserveSig] int GetWindowDesktopId(IntPtr topLevelWindow, out Guid desktopId);
        [PreserveSig] int MoveWindowToDesktop(IntPtr topLevelWindow, ref Guid desktopId);
    }
    public static class Dwm
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
        // DWMWA_CLOAKED: nonzero when Windows keeps the window off the screen (another virtual desktop,
        // a Store app's frame while it starts) although IsWindowVisible says it is visible.
        public static bool Cloaked(IntPtr hwnd)
        {
            int value;
            return DwmGetWindowAttribute(hwnd, 14, out value, 4) == 0 && value != 0;
        }
    }
    public static class Desktops
    {
        public static bool OnCurrent(IntPtr hwnd)
        {
            IVirtualDesktopManager m = (IVirtualDesktopManager)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("aa509086-5ca9-4c25-8f95-589d3c07b48a")));
            int on;
            int hr = m.IsWindowOnCurrentVirtualDesktop(hwnd, out on);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            return on != 0;
        }
    }
}
'@
}

$script:E2eDesktopKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops'

function ConvertTo-E2eDesktopId {
    param([byte[]]$Bytes)
    -join @($Bytes | ForEach-Object { $_.ToString('x2') })
}

# The virtual desktops, by id (32 hex digits), in their order from left to right, as Explorer keeps
# them (16 bytes each). Empty while Windows has made no second desktop.
function Get-E2eDesktops {
    $ids = (Get-ItemProperty $script:E2eDesktopKey -Name VirtualDesktopIDs -ErrorAction SilentlyContinue).VirtualDesktopIDs
    if ($null -eq $ids) { return , @() }
    , @(for ($i = 0; $i + 16 -le $ids.Length; $i += 16) { ConvertTo-E2eDesktopId $ids[$i..($i + 15)] })
}

# The id of the virtual desktop that is shown, or $null.
function Get-E2eCurrentDesktop {
    $b = (Get-ItemProperty $script:E2eDesktopKey -Name CurrentVirtualDesktop -ErrorAction SilentlyContinue).CurrentVirtualDesktop
    if ($b) { ConvertTo-E2eDesktopId $b }
}

# How many virtual desktops there are.
function Get-E2eDesktopCount { [math]::Max(1, (Get-E2eDesktops).Count) }

# Remembers a virtual desktop that a case's own key made (its id, the moment the case sees it), so that
# the run, or the clean-up after it, closes it. Nothing else counts as the run's: a desktop that merely
# appears during a run may be a person's.
function Add-E2eNewDesktop {
    param([string]$Id)
    if ($Id -and $script:E2eRun.NewDesktops -notcontains $Id) { $script:E2eRun.NewDesktops.Add($Id); Write-E2eState }
}
# Closes the virtual desktop Id, one the run made: it goes there one desktop at a time (Win+Ctrl+Left
# or Right), checking after each step which desktop is shown, and closes it (Win+Ctrl+F4). Every switch
# is paced. True when the desktop is gone (or was already); false when it could not be reached or did
# not close, and then nothing else is pressed.
function Close-E2eDesktop {
    param([string]$Id)
    for ($step = 0; $step -lt 20; $step++) {
        $all = Get-E2eDesktops
        $target = [array]::IndexOf($all, $Id)
        if ($target -lt 0) { return $true }
        $current = Get-E2eCurrentDesktop
        $at = [array]::IndexOf($all, $current)
        if ($at -lt 0) { return $false }
        Wait-ScreenChange
        if ($at -eq $target) {
            Send-E2eChord 'LWin+Ctrl+F4'
            return [bool](Wait-E2eCondition { (Get-E2eDesktops) -notcontains $Id } -TimeoutMs 3000)
        }
        Send-E2eChord $(if ($target -gt $at) { 'LWin+Ctrl+Right' } else { 'LWin+Ctrl+Left' })
        if (-not (Wait-E2eCondition { (Get-E2eCurrentDesktop) -ne $current } -TimeoutMs 3000)) { return $false }
        Wait-ScreenChange -Observed
    }
    $false
}

# Closes every virtual desktop the run made; throws when one stays.
function Close-E2eNewDesktops {
    foreach ($d in @($script:E2eRun.NewDesktops)) {
        if (-not (Close-E2eDesktop $d)) { throw "the virtual desktop $d, which the run made, could not be closed" }
        [void]$script:E2eRun.NewDesktops.Remove($d)
        Write-E2eState
    }
}

# The environment a macropad under test gets on top of this process's own. OMB_E2E, one of the test's
# own variables that Start-E2eProcess takes away, is given back to it: with OMB_E2E_DIR it turns on the
# macropad's command log (what its keys' commands did, Get-E2eCommandLines).
function Get-E2eMacropadEnvironment {
    @{
        OMB_E2E         = '1'
        OMB_E2E_DIR     = $script:E2eRun.Dir
        OMB_E2E_STANDIN = Join-Path $script:E2eFixtures 'standin.ahk'
        PATH            = (Join-Path $script:E2eRun.Dir 'path') + ';' + $env:PATH
        TEMP            = Join-Path $script:E2eRun.Dir 'temp'
        TMP             = Join-Path $script:E2eRun.Dir 'temp'
    }
}

# ---------------------------------------------------------------------------------------------------
# Stand-in windows (ahk\tests\e2e\standin.ahk).

function Start-E2eStandin {
    param([Parameter(Mandatory)][string]$Name, [string]$Exe = 'e2eapp.exe', [int]$X = 40, [int]$Y = 120, [int]$Width = 420, [int]$Height = 160)
    $log = Join-Path $script:E2eRun.Dir "standin-$Name.log"
    $arguments = '"{0}" "{1}" "{2}" {3} {4} {5} {6}' -f (Join-Path $script:E2eFixtures 'standin.ahk'), $log, $Name, $X, $Y, $Width, $Height
    Wait-ScreenChange
    $p = Start-E2eProcess (Get-E2eAhkCopy $Exe) $arguments
    $standin = Wait-E2eStandinLog $log -TimeoutMs 10000
    if ($null -eq $standin) {
        # What a person reading the build's log needs to tell a slow start from a stand-in that could not
        # start: whether its process still runs, a window it shows (AutoHotkey reports a load error in one),
        # what it wrote, and the window in front.
        $p.Refresh()
        $process = if ($p.HasExited) { "its process ended with exit code $($p.ExitCode)" } else { "its process (pid $($p.Id)) still runs, main window '$($p.MainWindowTitle)'" }
        $wrote = if (Test-Path -LiteralPath $log) { "its log holds: $(@(Read-E2eLog $log) -join ' / ')" } else { 'it wrote no log' }
        throw "The stand-in '$Name' did not start within 10 s: $process; $wrote; in front: $(Get-E2eForegroundText)."
    }
    Wait-ScreenChange -Observed
    $standin | Add-Member Process $p
    $standin | Add-Member Rect (Get-WindowRect $standin.Hwnd)
    $script:E2eRun.Standins[$Name] = $standin
    $standin
}

# A stand-in from its log: Name, Log, Pid, Hwnd, once its window is up; $null when TimeoutMs pass first.
function Wait-E2eStandinLog {
    param([string]$Log, [int]$TimeoutMs = 5000)
    Wait-E2eCondition {
        $first = @(Read-E2eLog $Log) | Select-Object -First 1
        if ($first -match '^start (.+) pid=(\d+) hwnd=(\d+)$') {
            [pscustomobject]@{ Name = $Matches[1]; Log = $Log; Pid = [int]$Matches[2]; Hwnd = [IntPtr][long]$Matches[3] }
        }
    } -TimeoutMs $TimeoutMs
}

# The lines of a log file that another process may be writing; none when it does not exist yet. The
# file is opened sharing reading and writing, and so it is by every writer of the suite (E2eWrite in
# commands.ahk and commands.ps1, the stand-in; the launcher's File.AppendAllText shares reading, which
# is enough beside a reader), so the test and a writer never refuse each other, however their opens
# fall. One log has a writer that is not the suite's: the PowerShell macropad's own (Write-MacropadLog,
# which appends through a stream sharing reading and writing, as Add-Content did not). A program outside
# the suite may still refuse a reader, so the reader waits for the file as for any other condition, for
# up to 300 ms, and then fails saying what refused it.
function Read-E2eLog {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    $refused = @{}
    $stream = Wait-E2eCondition {
        try { [System.IO.FileStream]::new($Path, 'Open', 'Read', 'ReadWrite') }
        catch [System.IO.IOException] { $refused.Message = $_.Exception.GetBaseException().Message }
    } -TimeoutMs 300 -EveryMs 15
    if ($null -eq $stream) {
        throw ("The log $Path could not be opened for reading for 300 ms: $($refused.Message) A program that does not share reading has had it open " +
            'for longer than a write takes (in Windows PowerShell, an Add-Content that was refused keeps its file open until its process collects garbage).')
    }
    try {
        $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::UTF8)
        $text = $reader.ReadToEnd()
    } finally { $stream.Dispose() }
    @($text -split "\r?\n" | Where-Object { $_ -ne '' })
}

# How many lines a stand-in's log has now: read the events after this mark.
function Get-E2eStandinMark {
    param($Standin)
    @(Read-E2eLog $Standin.Log).Count
}

# The stand-in's log lines after Mark, as events: Kind (down, up, char, click, close, command), Vk, Up;
# a command (a WM_COMMAND posted to the window, such as Chrome's own commands) has its number in Id.
function Get-E2eStandinEvents {
    param($Standin, [int]$Mark = 0)
    $lines = @(Read-E2eLog $Standin.Log)
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -match '^(down|up) vk=([0-9A-F]{2}) sc=([0-9A-F]+) repeat=(\d) mods=(\S+)$') {
            [pscustomobject]@{ Kind = $Matches[1]; Vk = [Convert]::ToInt32($Matches[2], 16); Up = $Matches[1] -eq 'up'; Repeat = $Matches[4] -eq '1'; Mods = $Matches[5]; Line = $line }
        } elseif ($line -match '^char ([0-9A-F]{4})$') {
            [pscustomobject]@{ Kind = 'char'; Vk = 0; Char = [char][Convert]::ToInt32($Matches[1], 16); Up = $false; Repeat = $false; Mods = ''; Line = $line }
        } elseif ($line -match '^command (\d+)$') {
            [pscustomobject]@{ Kind = 'command'; Vk = 0; Id = [int]$Matches[1]; Up = $false; Repeat = $false; Mods = ''; Line = $line }
        } elseif ($line -match '^(click|close)') {
            [pscustomobject]@{ Kind = $Matches[1]; Vk = 0; Up = $false; Repeat = $false; Mods = ''; Line = $line }
        }
    }
}

# Key events (Vk, Up, and Kind 'char' with Char for typed text) as the taps they make, such as
# 'Ctrl+Shift+t'; a run of typed characters is one tap 'text:<the characters>'. The macro keys F13 to
# F24, auto-repeats and vk E8 (the key AutoHotkey and Send-Ahk press to keep a lone Alt or Win from
# opening a menu) are left out. Throws when the key events are not whole chords.
function ConvertTo-E2eTap {
    param([object[]]$Events)
    $taps = [System.Collections.Generic.List[string]]::new()
    $keys = [System.Collections.Generic.List[object]]::new()
    $text = [System.Text.StringBuilder]::new()
    $flushKeys = { if ($keys.Count -gt 0) { foreach ($t in (ConvertTo-ChordTap $keys.ToArray())) { $taps.Add($t) }; $keys.Clear() } }
    # A down of a key already down in these events is an auto-repeat. (Windows' own repeat bit is not
    # used: it says what the system thought before, which a key let go elsewhere can leave wrong.)
    $down = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($e in @($Events)) {
        if ($e.Kind -eq 'char') { & $flushKeys; [void]$text.Append($e.Char); continue }
        if ($e.Vk -eq 0xE8 -or ($e.Vk -ge 0x7C -and $e.Vk -le 0x87)) { continue }
        if ($e.Up) { [void]$down.Remove([int]$e.Vk) } elseif (-not $down.Add([int]$e.Vk)) { continue }
        if ($text.Length -gt 0) { $taps.Add("text:$text"); [void]$text.Clear() }
        $keys.Add($e)
    }
    & $flushKeys
    if ($text.Length -gt 0) { $taps.Add("text:$text") }
    , $taps.ToArray()
}

# The taps a stand-in received after Mark (see ConvertTo-E2eTap).
function Get-E2eStandinTaps {
    param($Standin, [int]$Mark = 0)
    ConvertTo-E2eTap @(Get-E2eStandinEvents $Standin $Mark | Where-Object { $_.Kind -in 'down', 'up', 'char' })
}

# The taps the key watch saw since it was cleared (see ConvertTo-E2eTap).
function Get-E2eWatchTaps {
    $events = foreach ($line in [OmbE2e.KeyWatch]::Events()) {
        $p = $line -split ' '
        [pscustomobject]@{ Kind = $p[0]; Vk = [Convert]::ToInt32($p[1], 16); Up = $p[0] -eq 'up'; Repeat = $false }
    }
    ConvertTo-E2eTap @($events)
}

# Waits until Read (a scriptblock giving taps) gives at least Count taps, a chord still being pressed
# counting as none yet; then waits SettleMs more and reads again, so that a key that comes after counts
# too. The taps read last.
function Wait-E2eTaps {
    param([scriptblock]$Read, [int]$Count, [int]$TimeoutMs = 4000, [int]$SettleMs = 300)
    [void](Wait-E2eCondition { try { $t = & $Read; if ($t.Count -ge $Count) { , $t } } catch { $null } } -TimeoutMs $TimeoutMs)
    Wait-Pump $SettleMs
    $taps = & $Read
    , @($taps)
}

# The taps a list of chords makes, such as @('Ctrl+e', 't'), or 'text:...' entries kept as they are:
# what a command should press, worked out on the keyboard layout of the active window.
function ConvertTo-E2eExpectedTap {
    param([string[]]$Chords)
    , @(foreach ($c in $Chords) {
            if ($c.StartsWith('text:')) { $c } else { foreach ($t in (ConvertTo-E2eTap @(ConvertTo-KeyEvent $c | ForEach-Object { [pscustomobject]@{ Kind = 'key'; Vk = $_.Vk; Up = $_.Up; Repeat = $false } }))) { $t } }
        })
}

# Makes a window the active one; true when it is. Bringing a covered window to the front changes the
# screen, so it is paced. The window is remembered as the one the case named (LastActivated): the macro
# key is pressed into it.
function Set-E2eActive {
    param([IntPtr]$Hwnd)
    if ($null -ne $script:E2eRun) { $script:E2eRun.LastActivated = $Hwnd }
    if ([Macropad.WindowApi]::Foreground() -eq $Hwnd) { return $true }
    Wait-ScreenChange
    $ok = Wait-E2eCondition { if ([Macropad.Native]::ActivateWindow($Hwnd)) { $true } } -TimeoutMs 3000 -EveryMs 100
    [bool]$ok
}

# Throws when the macropad under test has exited: a key pressed then would go to the window in front.
function Assert-E2eMacropadRuns {
    $m = $script:E2eRun.Macropad
    if ($null -eq $m -or $m.Process.HasExited) { throw "Not pressed: the macropad under test is not running. $((Get-E2eErrorLines) -join ' ')" }
}

# ---------------------------------------------------------------------------------------------------
# The macropad under test.

# Starts the macropad of Lang (from the run's copy, and working in it, so that what it starts works
# there too and not in the folder the test was called from) with the layout of one chunk of the cases.
function Start-E2eMacropad {
    param([Parameter(Mandatory)][ValidateSet('ahk', 'ps')][string]$Lang, [int]$Chunk = 1)
    $envs = Get-E2eMacropadEnvironment
    $envs.OMB_CONFIG = Join-Path $script:E2eRun.Dir "layout-$Lang-$Chunk.json"
    $app = Join-Path $script:E2eRun.Dir 'app'
    if ($Lang -eq 'ahk') {
        $arguments = '/ErrorStdOut=UTF-8 /include "{0}" "{1}"' -f (Join-Path $script:E2eFixtures 'commands.ahk'), (Join-Path $app 'ahk\main.ahk')
        $p = Start-E2eProcess (Get-AhkExe) $arguments -Environment $envs -WorkingDirectory $app
    } else {
        # With launch.vbs's switches and -File, through a loader that adds the test's own commands.
        $arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f (Join-Path $script:E2eRun.Dir 'start-ps.ps1')
        $p = Start-E2eProcess 'powershell.exe' $arguments -Environment $envs -WorkingDirectory $app
    }
    $script:E2eRun.Macropad = [pscustomobject]@{ Lang = $Lang; Process = $p; Layer = 1; Chunk = $Chunk }
    # Ready when it answers a key: the first key of the first layer runs E2eMark, and the macropad's
    # command log says that the command ran to its end. Until the macropad takes the key, it reaches the
    # window in front: the stand-in B, a window of the harness, which must be in front for every tap.
    $commands = Get-E2eCommandMark
    # B is made active once; should something else take the keyboard, B is taken back only under -Ci
    # (nobody at that desktop): on a developer's desktop the start fails, saying what was in front.
    $b = $script:E2eRun.Standins['B'].Hwnd
    if (-not (Set-E2eActive $b)) { throw "Not pressed: the stand-in B could not be made the active window for the readiness taps; $(Get-E2eForegroundText) was in front." }
    # A macropad that cannot start says why in a window of its own (the PowerShell one in a message box,
    # 'failed to start', and stays until it is closed): a failure here names what those windows say.
    try {
        $ready = Wait-E2eCondition {
            if ($p.HasExited) { throw "The $Lang macropad exited at start (exit code $($p.ExitCode)). $((Get-E2eErrorLines) -join ' ')" }
            if ($env:OMB_E2E_CI -eq '1') { [void](Set-E2eActive $b) }
            Assert-E2eFront $b 'the stand-in B (readiness taps)'
            Send-E2eTap $script:E2eFirstKeyVk
            Wait-E2eCondition { @(Get-E2eCommandLines $commands) -contains 'done E2eMark' } -TimeoutMs 700
        } -TimeoutMs 30000 -EveryMs 10
    } catch { throw "$($_.Exception.Message) The macropad's windows: $(Get-E2eMacropadDialogText)." }
    if (-not $ready) {
        $lines = @(Get-E2eCommandLines $commands)
        throw "The $Lang macropad did not answer its keys within 30 s: $(Get-E2eCommandText (Get-E2eCommandState $lines 'E2eMark') 'E2eMark' $lines). The macropad's windows: $(Get-E2eMacropadDialogText)."
    }
    # Answering its keys is no proof that the layout loaded. The PowerShell macropad registers its macro
    # keys first, then the layout's hotkeys; when the second step fails (main.ps1), it shows the message box
    # 'failed to start', whose message loop still takes the macro keys, so the readiness taps above are
    # answered, and every case would fail with no word of why. A macropad that started shows no window
    # with a title: its overlay has none and shows only while Fn is held, its tooltips have none, and its
    # tray icon, hotkey window and (AutoHotkey) script window are never visible.
    $dialogs = Get-E2eMacropadWindows -Others  # already a list
    if ($dialogs.Count -gt 0) {
        throw "The $Lang macropad answered its keys, but it shows a window of its own, which one that loaded its layout does not (the PowerShell one that failed to load it shows a message box, and goes on taking its keys behind it): $(Get-E2eMacropadDialogText)."
    }
    $script:E2eRun.Macropad
}

# The macropad of Lang with the layout of Chunk: the one running, or a new one in its place.
function Use-E2eMacropad {
    param([string]$Lang, [int]$Chunk)
    $m = $script:E2eRun.Macropad
    if ($null -ne $m -and $m.Lang -eq $Lang -and $m.Chunk -eq $Chunk -and -not $m.Process.HasExited) { return $m }
    Stop-E2eMacropad
    Start-E2eMacropad $Lang $Chunk
}

# Ends the macropad under test through its own exit command (E2eExit, the second key of the first
# layer), and by force when it is still there after 5 s.
function Stop-E2eMacropad {
    $m = $script:E2eRun.Macropad
    if ($null -eq $m) { return }
    if (-not $m.Process.HasExited) {
        try {
            Select-E2eLayer 1
            Assert-E2eMacropadRuns
            Send-E2eTap ($script:E2eFirstKeyVk + 1)
        } catch { Write-Host "End-to-end: could not ask the macropad to exit: $($_.Exception.Message)" }
        if (-not $m.Process.WaitForExit(5000)) { Write-Host 'End-to-end: the macropad did not exit by itself; ending it.' }
    }
    Stop-E2eProcessId $m.Process.Id
    $script:E2eRun.Macropad = $null
}

# What a window of the macropad's is, from its title and its class: 'Tooltip', 'Overlay' or 'Titled'.
# A tooltip is the common control both macropads show over the overlay, and it has no title, as the
# overlay has none. AutoHotkey's ToolTip has the control's own class, tooltips_class32; Windows Forms
# registers its own class for each control, WindowsForms10.<the control's class>.app.<...>, so its ToolTip
# is WindowsForms10.tooltips_class32.app.0.2d8c349_r8_ad1 as the first run on the agent printed it (what
# follows .app. is the application's and the build's, so it is matched as any text). The class is read
# whole: a Windows Forms overlay is WindowsForms10.Window.8.app.<...>, and a class that only contains
# the word is none of these. The overlay is the one window without a title that is not a tooltip; a
# form or a message box has a title.
function Get-E2eWindowKind {
    param([string]$Title, [string]$Class)
    if ($Class -match '^(tooltips_class32|WindowsForms10\.tooltips_class32\.app\..+)$') { return 'Tooltip' }
    if ($Title -eq '') { return 'Overlay' }
    'Titled'
}

# The visible windows of the macropad under test, each as its handle, title and class.
function Get-E2eMacropadWindowInfo {
    $m = $script:E2eRun.Macropad
    if ($null -eq $m) { return , @() }
    , @([Macropad.Native]::GetProcessWindows([int[]]@($m.Process.Id)) | ForEach-Object {
            [pscustomobject]@{ Hwnd = $_; Title = [Macropad.WindowApi]::Title($_); Class = [Macropad.WindowApi]::ClassName($_) }
        })
}

# The macropad's visible windows (its overlay while Fn is held, a tooltip of the overlay, a form, a
# message box), as handles in one list (return , @(...): an empty list is not nothing, and a list of one is
# still a list). -Overlay: the overlay (not a tooltip); -Tooltips: its tooltips, of either version, which
# may stay up a moment after the overlay hid; -Others: the windows that have a title.
function Get-E2eMacropadWindows {
    param([switch]$Overlay, [switch]$Others, [switch]$Tooltips)
    $info = Get-E2eMacropadWindowInfo
    if ($Overlay) { return , @($info | Where-Object { (Get-E2eWindowKind $_.Title $_.Class) -eq 'Overlay' } | ForEach-Object { $_.Hwnd }) }
    if ($Tooltips) { return , @($info | Where-Object { (Get-E2eWindowKind $_.Title $_.Class) -eq 'Tooltip' } | ForEach-Object { $_.Hwnd }) }
    if ($Others) { return , @($info | Where-Object { $_.Title -ne '' } | ForEach-Object { $_.Hwnd }) }
    , @($info | ForEach-Object { $_.Hwnd })
}

# The macropad's visible windows in words, for a failure message: handle, title, class, and where on
# the screen.
function Get-E2eMacropadWindowsText {
    $all = Get-E2eMacropadWindows
    if ($all.Count -eq 0) { return 'none' }
    (@($all | ForEach-Object { $r = [Macropad.WindowApi]::Rect($_); "$_ '$([Macropad.WindowApi]::Title($_))' $([Macropad.WindowApi]::ClassName($_)) at $($r[0]), $($r[1]) size $($r[2]) x $($r[3])" }) -join '; ')
}

# What a form says: the texts of its controls, for a failure message.
function Get-E2eFormText {
    param([IntPtr]$Form)
    (@([Macropad.WindowApi]::Children($Form) | ForEach-Object { Get-ControlText $_ } | Where-Object { $_ }) -join ' | ')
}

# The macropad's windows that have a title (a form, a message box), each with what its controls say, for a
# failure message: 'none' when it shows none. It never throws: it adds to a failure, never replaces one.
function Get-E2eMacropadDialogText {
    try {
        $all = Get-E2eMacropadWindows -Others
        if ($all.Count -eq 0) { return 'none' }
        (@($all | ForEach-Object { "'$([Macropad.WindowApi]::Title($_))' says: $(Get-E2eFormText $_)" }) -join '; ')
    } catch { "they could not be read ($($_.Exception.Message))" }
}

# What the waits on the macropad's windows look at. Each gives nothing while the window is not there (the
# wait goes on) and the window's handle once it is: Wait-E2eCondition takes an empty list for a look that
# was met. The list comes from Get-E2eMacropadWindows as one object: it is used as it is.

# The first tooltip of the macropad's that shows now.
function Get-E2eTooltip {
    $t = Get-E2eMacropadWindows -Tooltips
    if ($t.Count -gt 0) { $t[0] }
}

# The overlay when exactly one window of the macropad's is one (two would be an overlay and something
# else, and the wait goes on).
function Get-E2eSoleOverlay {
    $o = Get-E2eMacropadWindows -Overlay
    if ($o.Count -eq 1) { $o[0] }
}

# Whether a tooltip of the macropad's shows now.
function Test-E2eTooltipUp {
    (Get-E2eMacropadWindows -Tooltips).Count -gt 0
}

# Selects a layer as a person does: hold Fn, press the layer's key, let Fn go. The overlay shows and
# hides, so both are paced. Fn is let go however the selection ends.
function Select-E2eLayer {
    param([Parameter(Mandatory)][int]$Index)
    $m = $script:E2eRun.Macropad
    if ($m.Layer -eq $Index) { return }
    Assert-E2eMacropadRuns
    Wait-ScreenChange
    Send-E2eKey $script:E2eFnVk
    try {
        $shown = Wait-E2eCondition { (Get-E2eMacropadWindows -Overlay).Count -gt 0 } -TimeoutMs 3000
        Send-E2eTap ($script:E2eFirstKeyVk + $Index - 1)
        Wait-ScreenChange
    } finally { Send-E2eKey $script:E2eFnVk -Up }
    if (-not $shown) { throw "The overlay did not show while Fn was held (layer $Index)." }
    $hidden = Wait-E2eCondition { (Get-E2eMacropadWindows -Overlay).Count -eq 0 } -TimeoutMs 3000
    if (-not $hidden) { throw "The overlay did not hide when Fn was let go (layer $Index)." }
    Wait-ScreenChange -Observed
    $m.Layer = $Index
}

# Presses the macro key of a slot (1 to 11) on the current layer.
function Invoke-E2eMacroKey {
    param([Parameter(Mandatory)][int]$Slot)
    Assert-E2eMacropadRuns
    Send-E2eTap ($script:E2eFirstKeyVk + $Slot - 1)
}

# ---------------------------------------------------------------------------------------------------
# The pointer on the overlay. Both macropads draw the overlay from the same model of the layout file
# (Import-MacropadConfig; Config.Tests.ps1 holds the AutoHotkey version to the same geometry): a key's
# label and icon are child controls of the overlay window, placed at the model's rectangle from the
# window's client origin. AutoHotkey scales those rectangles by the screen's DPI (its Gui's DPIScale,
# on by default), the PowerShell overlay does not scale them and Windows stretches the whole window
# instead, and what this process sees of either depends on its own DPI awareness. So the scale is
# measured on the overlay as it is drawn, not assumed (ConvertTo-E2eOverlayPoint): at 100 % it is 1.

# The screen point at the middle of a key's label or icon (Part) on the overlay that shows now (Fn
# held): Slot is the key (1 to 11), on the layout file the macropad under test runs.
function Get-E2eOverlayPoint {
    param([Parameter(Mandatory)][int]$Slot, [Parameter(Mandatory)][ValidateSet('Label', 'Icon')][string]$Part)
    if ($null -eq $script:E2eRun.Macropad) { throw 'No macropad under test runs: there is no overlay to point at.' }
    $overlay = Get-E2eMacropadWindows -Overlay
    if ($overlay.Count -ne 1) { throw "The overlay must show as one window to point at it; the macropad's visible windows: $(Get-E2eMacropadWindowsText)." }
    $controls = @(foreach ($c in [Macropad.WindowApi]::Children($overlay[0])) { , [Macropad.WindowApi]::Rect($c) })
    ConvertTo-E2eOverlayPoint (Get-E2eLayoutModel) $Slot $Part ([Macropad.WindowApi]::ClientRect($overlay[0])) $controls
}

# The layout the macropad under test runs, as the model both versions draw the overlay from.
function Get-E2eLayoutModel {
    $m = $script:E2eRun.Macropad
    Import-MacropadConfig (Join-Path $script:E2eRun.Dir "layout-$($m.Lang)-$($m.Chunk).json")
}

# What the overlay's control at a point (Get-E2eOverlayPoint) reads, as Windows gives a control's text:
# for the middle of a key's label, the name of that key's command on the layer the overlay shows. $null
# when no control of the overlay is there.
function Get-E2eOverlayText {
    param([IntPtr]$Overlay, $Point)
    foreach ($c in [Macropad.WindowApi]::Children($Overlay)) {
        $r = [Macropad.WindowApi]::Rect($c)
        if ($Point.X -ge $r[0] -and $Point.X -lt $r[0] + $r[2] -and $Point.Y -ge $r[1] -and $Point.Y -lt $r[1] + $r[3]) { return Get-ControlText $c }
    }
    $null
}

# The screen point at the middle of a key's label or icon on an overlay drawn from Layout (the model,
# Import-MacropadConfig). Client is the overlay's client area (x, y on the screen, width, height:
# WindowApi.ClientRect); Controls are its child controls (each x, y, width, height on the screen). Both
# overlays place the controls of the keys, and of the Fn key when it shows, from the client origin, so
# together they reach exactly as far right and down as the model's keys do, at the scale the overlay is
# drawn at: that is the scale (AutoHotkey's window is larger than its controls, by its margins, so the
# client size would not do). Returns X, Y, the Scale and the key's Rect in the model. Throws when the
# controls do not fit the model at one scale: the overlay is then not drawn from this layout.
function ConvertTo-E2eOverlayPoint {
    param([Parameter(Mandatory)]$Layout, [int]$Slot, [ValidateSet('Label', 'Icon')][string]$Part, [int[]]$Client, [object[]]$Controls)
    $keys = @($Layout.Keys)
    if ($Slot -lt 1 -or $Slot -gt $keys.Count) { throw "The layout has no key $Slot; it has $($keys.Count)." }
    $key = $keys[$Slot - 1]
    if ($Part -eq 'Label') { $rect = @($key.Label.X, $key.Label.Y, $key.Label.W, $key.Label.H) } else { $rect = @($key.X, $key.Y, $key.W, $key.H) }
    if ($rect[2] -le 0 -or $rect[3] -le 0) { throw "Key $Slot has no $($Part.ToLower()) on the overlay: the layout shows no labels." }
    $drawn = @($keys) + @(if ($Layout.ShowFn -ne '') { $Layout.Fn })
    $width = ($drawn | ForEach-Object { $_.X + $_.W } | Measure-Object -Maximum).Maximum
    $height = ($drawn | ForEach-Object { $_.Y + $_.H } | Measure-Object -Maximum).Maximum
    $right = 0; $bottom = 0
    foreach ($c in @($Controls)) {
        $right = [math]::Max($right, $c[0] + $c[2] - $Client[0])
        $bottom = [math]::Max($bottom, $c[1] + $c[3] - $Client[1])
    }
    $scale = $right / $width
    # Each control is placed at its own rounded position: at 125 %, 330 px of the model are 412 or 413.
    if ($right -le 0 -or [math]::Abs($bottom - $height * $scale) -gt 2) {
        throw "The overlay's $(@($Controls).Count) controls reach $right x $bottom px from its client origin ($($Client[0]), $($Client[1])), which is not the layout's $width x $height px at one scale: the overlay is not drawn from this layout."
    }
    [pscustomobject]@{
        X     = $Client[0] + [int][math]::Floor(($rect[0] + $rect[2] / 2) * $scale)
        Y     = $Client[1] + [int][math]::Floor(($rect[1] + $rect[3] / 2) * $scale)
        Scale = $scale
        Rect  = $rect -join ', '
    }
}

# The point (Get-E2eOverlayPoint) must be on the overlay window: the window a click there goes to is the
# overlay or one of its controls. What, in words, for the message. Throws, naming the window that is
# there, when it is not: a transparent pixel of the overlay (a click would go through it), or another
# window over it.
function Assert-E2eOnOverlay {
    param($Point, [IntPtr]$Overlay, [string]$What)
    $at = [OmbE2e.Input]::TopWindowAt($Point.X, $Point.Y)
    if ($at -ne $Overlay) {
        $r = [Macropad.WindowApi]::Rect($Overlay)
        throw "The pointer at ($($Point.X), $($Point.Y)), $What (the layout's rectangle $($Point.Rect) at scale $($Point.Scale)), is not on the overlay $Overlay (at $($r[0]), $($r[1]) size $($r[2]) x $($r[3])): a click there would go to $(Get-E2eWindowText $at)."
    }
}

# The line the end-to-end run prints for the wait that follows an overlay (Invoke-E2eOverlayPointer): the
# case (the macropad and the case's name); AtFn, whether a tooltip of the macropad's showed in the look
# just before Fn was let go ($true, $false, or $null when that look failed); SeenAfter, whether one showed
# in a look of the wait that began once the overlay was seen hidden; and GoneAfterMs, how many
# milliseconds after the overlay was seen hidden the wait found none ($null when one was still there at
# the limit, LimitMs). Counted from just before the wait, so up to one look (tens of ms) more than the
# wait's own count, which starts after its first look: a figure a little over the limit can be a pass.
function Format-E2eOverlayTooltipTime {
    param([string]$Case, $AtFn, [bool]$SeenAfter, $GoneAfterMs, [int]$LimitMs)
    $line = "Overlay tooltip, ${Case}: "
    if ($AtFn -eq $true) {
        $line += 'showing when Fn was let go, '
        if ($null -eq $GoneAfterMs) { return $line + "still showing $LimitMs ms after the overlay was seen hidden" }
        if ($SeenAfter) { return $line + "gone $GoneAfterMs ms after the overlay was seen hidden (limit $LimitMs ms)" }
        return $line + "gone by the time the overlay was seen hidden (none at the first look after it; limit $LimitMs ms)"
    }
    if ($AtFn -eq $false) { $line += 'none showing when Fn was let go, ' } else { $line += 'not known whether one showed when Fn was let go (the look failed), ' }
    if ($null -eq $GoneAfterMs) { return $line + "but one showing $LimitMs ms after the overlay was seen hidden" }
    if ($SeenAfter) { return $line + "but one showing after the overlay was seen hidden, gone $GoneAfterMs ms after it (limit $LimitMs ms)" }
    $line + 'and none after the overlay was seen hidden'
}

# Holds Fn until the overlay shows and gives Action the overlay's window; then, however Action ended,
# looks whether a tooltip of the macropad's shows and lets Fn go, with the pointer left where Action put
# it, waits for the overlay to hide and for every tooltip of the macropad's to be gone within
# $script:E2eTooltipGoneMs of the overlay being seen hidden (a tooltip goes with its overlay in both
# versions, also under a pointer that does not move), prints what it saw (Format-E2eOverlayTooltipTime),
# and only then puts the pointer back where it was: a pointer put back while the overlay still shows could
# raise a tooltip of the harness's own, and one that moves would take an AutoHotkey tip away by itself. A
# tooltip has no title, as the overlay has none, and one left on the screen would stand over the next
# case. With -TooltipAtRelease the case has seen a tooltip up at its last step, and this fails unless the
# look before Fn's release saw one too and the wait for the tooltip began within
# $script:E2eTooltipProofMs of that step: otherwise the run cannot tell a tooltip that goes with the
# overlay from one that ran out by itself. Before Fn goes down, the pointer rests on the title bar of the
# stand-in B (top left of the screen), off the overlay (the middle of the screen), so that no tooltip
# shows before Action puts the pointer where it wants it. Each change of the screen is paced. Fn is let go
# and the pointer put back whatever happened. What this throws starts with Action's failure, and what
# could not be put back follows it. The variables have names of their own: Action runs inside this
# function and reads the case's variables by name.
function Invoke-E2eOverlayPointer {
    param([Parameter(Mandatory)][scriptblock]$Action, [switch]$TooltipAtRelease)
    Assert-E2eMacropadRuns
    $e2eFrom = [OmbE2e.Input]::MousePosition()
    $e2eFailure = $null
    $e2eProblems = [System.Collections.Generic.List[string]]::new()
    $e2eStep = { param([scriptblock]$Do) try { & $Do } catch { $e2eProblems.Add($_.Exception.Message) } }
    # What the look just before Fn's release saw ($null when it could not look), and a clock from the end
    # of Action.
    $e2eTipAtFn = $null
    $e2eSinceAction = $null
    try {
        try {
            $e2eRest = Get-WindowRect $script:E2eRun.Standins['B'].Hwnd
            Move-E2ePointer ($e2eRest.X + [int]($e2eRest.Width / 2)) ($e2eRest.Y + 10)
            Wait-ScreenChange
            Send-E2eKey $script:E2eFnVk
            $e2eOverlay = Wait-E2eCondition { Get-E2eSoleOverlay } -TimeoutMs 3000
            if ($null -eq $e2eOverlay) { throw "The overlay did not show as one window within 3 s while Fn was held; the macropad's visible windows: $(Get-E2eMacropadWindowsText); in front: $(Get-E2eForegroundText)." }
            & $Action $e2eOverlay
            $e2eSinceAction = [System.Diagnostics.Stopwatch]::StartNew()
        } catch { $e2eFailure = $_ }
        finally {
            # Also when the run is stopped. Fn is let go by name, as Select-E2eLayer lets it go: a macropad's
            # hook may keep it from Windows' key state, which is all Clear-E2eHeldKeys reads. The look
            # cannot keep Fn down: whatever it throws, Fn is let go.
            try { Wait-ScreenChange } finally {
                try { $e2eTipAtFn = Test-E2eTooltipUp }
                catch { $e2eProblems.Add("whether a tooltip of the macropad's showed when Fn was let go could not be read: $($_.Exception.Message)") }
                finally { Send-E2eKey $script:E2eFnVk -Up }
            }
        }
        & $e2eStep {
            if (-not (Wait-E2eCondition { (Get-E2eMacropadWindows -Overlay).Count -eq 0 } -TimeoutMs 3000)) { throw "the overlay did not hide within 3 s of Fn being let go; the macropad's visible windows: $(Get-E2eMacropadWindowsText)" }
            Wait-ScreenChange -Observed
        }
        & $e2eStep {
            $sinceAction = if ($null -ne $e2eSinceAction) { $e2eSinceAction.ElapsedMilliseconds }
            $after = @{ Seen = $false }
            $clock = [System.Diagnostics.Stopwatch]::StartNew()
            $gone = Wait-E2eCondition { $t = Get-E2eMacropadWindows -Tooltips; if ($t.Count -gt 0) { $after.Seen = $true }; $t.Count -eq 0 } -TimeoutMs $script:E2eTooltipGoneMs
            # Said whether the case passes or fails, as the NextWindow cases say theirs: how long a tooltip took to go.
            Write-Host (Format-E2eOverlayTooltipTime $script:E2eRun.Case $e2eTipAtFn $after.Seen $(if ($gone) { $clock.ElapsedMilliseconds }) $script:E2eTooltipGoneMs)
            if (-not $gone) { throw "a tooltip of the macropad's still showed $($script:E2eTooltipGoneMs) ms after the overlay was seen hidden, Fn let go and the pointer left where it was (the tooltip must go with the overlay); the macropad's visible windows: $(Get-E2eMacropadWindowsText)" }
            if ($e2eTipAtFn -or $after.Seen) { Wait-ScreenChange -Observed }
            if ($TooltipAtRelease -and $null -eq $e2eFailure) {
                if ($e2eTipAtFn -eq $false) { throw "no tooltip of the macropad's showed in the look just before Fn was let go, though the case had seen one up: the hide was not tried with a tooltip up, so this run does not show that the tooltip goes with the overlay" }
                if ($sinceAction -gt $script:E2eTooltipProofMs) { throw "the wait for the tooltip to go began $sinceAction ms after the case had seen the tooltip up, more than $($script:E2eTooltipProofMs) ms (the pacing floor, the look, Fn's release and the wait for the overlay to hide): a tooltip that ran out its own 5 s, as the PowerShell one did before 1.0.7, could then be gone within the limit too, so this run does not show that the tooltip goes with the overlay" }
            }
        }
    } finally {
        [void][OmbE2e.Input]::MoveMouse($e2eFrom[0], $e2eFrom[1])
    }
    & $e2eStep {
        $at = [OmbE2e.Input]::MousePosition()
        if ($at[0] -ne $e2eFrom[0] -or $at[1] -ne $e2eFrom[1]) { throw "the pointer could not be put back at ($($e2eFrom -join ', ')); it is at ($($at -join ', '))" }
    }
    if ($e2eFailure) {
        if ($e2eProblems.Count -eq 0) { throw $e2eFailure }
        throw "$($e2eFailure.Exception.Message)`nThen, letting go of the overlay: $($e2eProblems -join '; ')"
    }
    if ($e2eProblems.Count -gt 0) { throw "Letting go of the overlay: $($e2eProblems -join '; ')" }
}

# The display options a case that uses the pointer on the overlay counts on, as the example layout has
# them (Get-E2eLayoutOptions): labels shown and macro icons off, so that a key's label shows its command
# and a click on the label runs it, in both versions; with -IconSelectsLayer also iconAction 'Layer' (the
# default when it is left out), so that a click on a key's icon selects that key's layer. Throws, naming
# the options, when config.json says otherwise: the case would click something else than it says.
function Assert-E2eOverlayOptions {
    param([switch]$IconSelectsLayer)
    $o = Get-E2eLayoutOptions
    $iconAction = if ($null -ne $o.iconAction) { $o.iconAction } else { 'Layer' }
    $ok = $o.showLabels -eq $true -and $o.useMacroIcons -ne $true -and (-not $IconSelectsLayer -or $iconAction -eq 'Layer')
    if (-not $ok) {
        $want = if ($IconSelectsLayer) { "showLabels true, useMacroIcons false and iconAction 'Layer'" } else { 'showLabels true and useMacroIcons false' }
        throw "The case counts on the example layout's $want; config.json has showLabels $($o.showLabels), useMacroIcons $($o.useMacroIcons), iconAction '$($o.iconAction)'."
    }
}

# ---------------------------------------------------------------------------------------------------
# The layout file's hotkeys and hotstrings ($script:E2eHookLayout), which the cases with Hooks press and
# type. Their action, E2eHotkey, appends its macro's name to hotkeys.log in the run's folder, in both
# languages: the AutoHotkey macropad writes nothing to its command log for them (ConfigRunner in
# ahk\config.ahk calls the action itself), so this file is what says that one ran, and which.

function Get-E2eHotkeyLogPath { Join-Path $script:E2eRun.Dir 'hotkeys.log' }

# How many lines hotkeys.log has now: read the lines after this mark.
function Get-E2eHotkeyMark { @(Read-E2eLog (Get-E2eHotkeyLogPath)).Count }

# The lines of hotkeys.log after Mark: one per run of a hotkey or hotstring, its name as the layout writes it.
function Get-E2eHotkeyLines {
    param([int]$Mark = 0)
    @(Read-E2eLog (Get-E2eHotkeyLogPath) | Select-Object -Skip $Mark)
}

# The text a text box would hold after the key events of a stand-in's log lines, from empty: a typed
# character (a 'char' line: text sent as such, which comes as VK_PACKET) is added, and so is what a key
# pressed with neither Ctrl, Alt nor Win held types on a US keyboard: a letter (a capital with Shift),
# a digit of the top row (without Shift), a space. Backspace takes the last character away, if there is
# one. Each down counts, an auto-repeat too, as in a text box. Key ups, keys pressed with Ctrl, Alt or
# Win, every other key (Shift with a digit among them) and lines that are no key add nothing. The
# stand-in logs a key's down and up, not the character Windows makes of it (standin.ahk), so the
# characters of keys are worked out here; the test types only letters, digits and spaces.
function ConvertTo-E2eTypedText {
    param([string[]]$Lines)
    $text = [System.Text.StringBuilder]::new()
    foreach ($line in @($Lines)) {
        $c = $null
        if ($line -cmatch '^char ([0-9A-F]{4})$') { $c = [char][Convert]::ToInt32($Matches[1], 16) }
        elseif ($line -cmatch '^down vk=([0-9A-F]{2}) sc=[0-9A-F]+ repeat=\d mods=(\S+)$') {
            $vk = [Convert]::ToInt32($Matches[1], 16)
            $mods = $Matches[2]
            if ($mods -cmatch '[CAW]') { continue }
            if ($vk -eq 0x08) { $c = [char]8 }
            elseif ($vk -eq 0x20) { $c = [char]' ' }
            elseif ($vk -ge 0x41 -and $vk -le 0x5A) { $c = if ($mods.Contains('S')) { [char]$vk } else { [char]($vk + 0x20) } }
            elseif ($vk -ge 0x30 -and $vk -le 0x39 -and -not $mods.Contains('S')) { $c = [char]$vk }
        }
        if ($null -eq $c) { continue }
        if ($c -eq [char]8) { if ($text.Length -gt 0) { [void]$text.Remove($text.Length - 1, 1) } }
        elseif (-not [char]::IsControl($c)) { [void]$text.Append($c) }
    }
    $text.ToString()
}

# The text a stand-in holds after the lines of its log after Mark (ConvertTo-E2eTypedText).
function Get-E2eStandinText {
    param($Standin, [int]$Mark = 0)
    ConvertTo-E2eTypedText @(Read-E2eLog $Standin.Log | Select-Object -Skip $Mark)
}

# Types Text into Hwnd as a person types, a key at a time: each character is its own key (the library's
# key name: a to z, 0 to 9, Space for a space), tapped alone with no modifier, and pressed only while Hwnd
# is in front; between two keys the pause Send-E2eChord leaves between two events. A hotstring
# recogniser sees each key as it comes, as from a keyboard. With no modifier a letter key types the small
# letter and a key of the top row its digit, on a US keyboard and on the others that have digits there
# (not on a French one, whose 2 key types an accented e): what is typed, and ConvertTo-E2eTypedText, count on that.
function Send-E2eText {
    param([IntPtr]$Hwnd, [string]$Text)
    foreach ($ch in $Text.ToCharArray()) {
        $vk = Get-VirtualKey $(if ($ch -eq ' ') { 'Space' } else { [string]$ch })
        Assert-E2eFront $Hwnd
        Send-E2eTap $vk
        Wait-Pump 15
    }
}

# ---------------------------------------------------------------------------------------------------
# The layouts. A layout has 11 layers of 11 keys; its first layer starts with the harness's own keys
# (E2eMark, which the start waits for, and E2eExit, which ends the macropad). When the cases need more
# keys than one layout has, they go on in a second layout (a chunk), and the macropad is started again
# with it: adding cases never runs out of keys.

# Where each of Count entries goes: Chunk, Layer and Slot, the first two slots of each chunk being the
# harness's own; then where each of Hooks more entries goes (the cases with Hooks), from the chunk after
# the last of the others on, so that no chunk holds both. Hooks says on each row which kind it is.
function Get-E2eSlotPlan {
    param([int]$Count, [int]$KeyCount = $script:E2eKeyCount, [int]$Hooks = 0)
    $perChunk = $KeyCount * $KeyCount - 2
    $groups = @(
        @{ Count = $Count; First = 1; Hooks = $false }
        @{ Count = $Hooks; First = [math]::Ceiling($Count / $perChunk) + 1; Hooks = $true }
    )
    , @(foreach ($g in $groups) {
            for ($i = 0; $i -lt $g.Count; $i++) {
                $chunk = [math]::Floor($i / $perChunk) + $g.First
                $n = ($i % $perChunk) + 2
                [pscustomobject]@{ Chunk = $chunk; Layer = [math]::Floor($n / $KeyCount) + 1; Slot = ($n % $KeyCount) + 1; Hooks = $g.Hooks }
            }
        })
}

# Writes the layout files of the cases (layout-<lang>-<chunk>.json in the run's folder) and gives each case
# its Chunk, Layer and Slot. The cases with Hooks go into layouts of their own, after those of all the
# others, and only those layouts have the layout file's hotkeys and hotstrings ($script:E2eHookLayout):
# the key hook they bring (the PowerShell macropad installs one only for a layout that has them) cannot
# touch any other case, and the others keep the keys they had without them.
function Write-E2eLayout {
    param([object[]]$Cases)
    $plain = @($Cases | Where-Object { -not $_.Hooks })
    $hooked = @($Cases | Where-Object { $_.Hooks })
    $ordered = @($plain) + @($hooked)
    $plan = Get-E2eSlotPlan $plain.Count -Hooks $hooked.Count
    $chunks = [math]::Max(1, ($plan | Measure-Object Chunk -Maximum).Maximum)
    for ($i = 0; $i -lt $ordered.Count; $i++) { foreach ($k in 'Chunk', 'Layer', 'Slot') { $ordered[$i].$k = $plan[$i].$k } }
    for ($chunk = 1; $chunk -le $chunks; $chunk++) {
        $mine = @($ordered | Where-Object { $_.Chunk -eq $chunk })
        $withHooks = @($mine | Where-Object { $_.Hooks }).Count -gt 0
        # One layout file per language: a case for one language only leaves its key empty in the other's.
        foreach ($lang in 'ahk', 'ps') {
            $slots = [System.Collections.Generic.List[object]]::new()
            $slots.Add(@{ action = 'E2eMark'; name = 'ready' })
            $slots.Add(@{ action = 'E2eExit'; name = 'exit' })
            foreach ($case in $mine) {
                if ($case.Only -and $case.Only -ne $lang) { $slots.Add($null); continue }
                $entry = @{ action = $case.Command; name = $case.Command; description = '' }
                if ($case.Macro) { foreach ($k in $case.Macro.Keys) { $entry[$k] = $case.Macro[$k] } }
                $slots.Add($entry)
            }
            Write-E2eLayoutFile $slots.ToArray() (Join-Path $script:E2eRun.Dir "layout-$lang-$chunk.json") -Hooks:$withHooks
        }
    }
    $script:E2eRun.Chunks = $chunks
}

# The display options of the example layout, the repository's config.json, that the test's layouts
# take, so that the overlay under test is drawn as a person's is: showFn, showMacroMarkers, showLabels,
# useMacroIcons and iconAction, with the values the file gives them. One the file leaves out is left
# out here too, and each macropad then takes its own default, as it would for a person.
function Get-E2eLayoutOptions {
    param([string]$Path = (Join-Path $script:E2eRepo 'config.json'))
    $json = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    $options = [ordered]@{}
    foreach ($name in 'showFn', 'showMacroMarkers', 'showLabels', 'useMacroIcons', 'iconAction') {
        if ($null -ne $json.PSObject.Properties[$name]) { $options[$name] = $json.$name }
    }
    [pscustomobject]$options
}

# Writes a layout file: the test's keys (F13 to F23, Fn F24) with the Slots on layers of 11 keys, and
# the display options of the example layout (Get-E2eLayoutOptions). A layout whose slots fill one layer
# gets a second layer without macros, so that there is always another layer to select: a click on an
# icon (E2eOverlayIcon) selects layer 1 from it. With -Hooks it also has the layout file's hotkeys and
# hotstrings that the cases with Hooks press and type ($script:E2eHookLayout).
function Write-E2eLayoutFile {
    param([object[]]$Slots, [string]$Path, $Options = (Get-E2eLayoutOptions), [switch]$Hooks)
    $keys = @(for ($i = 0; $i -lt $script:E2eKeyCount; $i++) { @{ key = "F$(13 + $i)"; row = [math]::Floor($i / 4) + 1; col = ($i % 4) + 1 } })
    $layers = @(for ($l = 0; $l * $script:E2eKeyCount -lt $Slots.Count; $l++) {
            $last = [math]::Min($Slots.Count, ($l + 1) * $script:E2eKeyCount) - 1
            @{ title = "Test $($l + 1)"; icon = 'default_commands'; macros = @($Slots[($l * $script:E2eKeyCount)..$last]) }
        })
    if ($layers.Count -eq 1) { $layers += @{ title = 'Test 2'; icon = 'default_commands'; macros = @() } }
    $layout = @{ fn = @{ key = 'F24'; row = 4; col = 1 }; keys = $keys; layers = $layers; default = 1 }
    foreach ($p in $Options.PSObject.Properties) { $layout[$p.Name] = $p.Value }
    if ($Hooks) { foreach ($k in $script:E2eHookLayout.Keys) { $layout[$k] = $script:E2eHookLayout[$k] } }
    [System.IO.File]::WriteAllText($Path, ($layout | ConvertTo-Json -Depth 8))
}

# ---------------------------------------------------------------------------------------------------
# Running a case.

# The lines a macropad under test wrote about an error: the AutoHotkey one through the test's OnError
# (errors.log), the PowerShell one through Show-MacropadError (its log in the run's TEMP).
function Get-E2eErrorLines {
    @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'errors.log')) + @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'temp\LayeredMacropad.log'))
}

# A window, described for a message.
function Get-E2eWindowText {
    param([IntPtr]$Hwnd)
    $i = Get-WindowInfo $Hwnd
    "'$($i.Title)' ($($i.Exe), class $($i.Class))"
}

# The window that has the keyboard, described for a message.
function Get-E2eForegroundText {
    Get-E2eWindowText ([Macropad.WindowApi]::Foreground())
}

# A window in front that the run did not start and the case does not expect: a person or another
# program took the focus during the case. Its description, or $null.
function Get-E2eForeignForeground {
    param($Case)
    $h = [Macropad.WindowApi]::Foreground()
    if ($h -eq [IntPtr]::Zero) { return $null }
    $info = Get-WindowInfo $h
    $ours = @($script:E2eRun.Processes | ForEach-Object { $_.Pid })
    if ($null -ne $script:E2eRun.Macropad) { $ours += $script:E2eRun.Macropad.Process.Id }
    if ($ours -contains $info.Pid) { return $null }
    if (@($Case.Targets) -contains $info.Exe) { return $null }
    if ($info.Exe -in 'explorer.exe', 'ShellExperienceHost.exe', 'ShellHost.exe', 'SearchHost.exe', 'StartMenuExperienceHost.exe') { return $null }
    Get-E2eForegroundText
}

# Activates the stand-in Name and returns it.
function Use-E2eStandin {
    param([string]$Name)
    $s = $script:E2eRun.Standins[$Name]
    if (-not (Set-E2eActive $s.Hwnd)) { throw "The stand-in '$Name' could not be made the active window; in front is $(Get-E2eForegroundText)." }
    $s
}

# The default Arrange and Assert of a Chord case.
$script:E2eChordArrange = {
    param($ctx)
    $ctx.Standin = Use-E2eStandin 'A'
    # The expected keys are worked out while A is active, on its keyboard layout.
    $ctx.Expected = ConvertTo-E2eExpectedTap $ctx.Case.Chords
    $ctx.Mark = Get-E2eStandinMark $ctx.Standin
    # A case that starts from another window: the command must bring A (its program) forward first.
    if ($ctx.Case.From) { [void](Use-E2eStandin $ctx.Case.From) }
}
$script:E2eChordAssert = {
    param($ctx)
    $want = @($ctx.Expected)
    # The keys are counted once the command has returned, when it has sent all it will send; a command
    # that never ran or never finished says so, instead of a list of keys that is short.
    [void](Assert-E2eCommandDone $ctx.Commands $ctx.Case.Command -TimeoutMs 8000)
    try { $got = Wait-E2eTaps { Get-E2eStandinTaps $ctx.Standin $ctx.Mark } $want.Count -TimeoutMs 8000 }
    catch { throw "The stand-in's key events are not whole chords ($($_.Exception.Message)): $((@(Read-E2eLog $ctx.Standin.Log) | Select-Object -Skip $ctx.Mark) -join ' / ')" }
    ($got -join ', ') | Should -Be ($want -join ', ') -Because "the stand-in must receive exactly the keys of $($ctx.Case.Command) (in front now: $(Get-E2eForegroundText); the stand-in's lines: $((@(Read-E2eLog $ctx.Standin.Log) | Select-Object -Skip $ctx.Mark) -join ' / '))"
    if ($ctx.Case.From) { [Macropad.WindowApi]::Foreground() | Should -Be $ctx.Standin.Hwnd -Because 'the command brings its program forward' }
}
# A Watch case: the keys are seen by the key watch (a low-level hook), which keeps Windows from acting
# on them; for chords that Windows takes before any window gets them.
$script:E2eWatchArrange = {
    param($ctx)
    $ctx.Standin = Use-E2eStandin 'A'
    $ctx.Expected = ConvertTo-E2eExpectedTap $ctx.Case.Chords
    $ctx.Mark = Get-E2eStandinMark $ctx.Standin
}
$script:E2eWatchAssert = {
    param($ctx)
    $want = @($ctx.Expected)
    [void](Assert-E2eCommandDone $ctx.Commands $ctx.Case.Command -TimeoutMs 8000)
    $got = Wait-E2eTaps { Get-E2eWatchTaps } $want.Count
    ($got -join ', ') | Should -Be ($want -join ', ') -Because "the keys pressed must be exactly those of $($ctx.Case.Command) (the key watch saw: $([OmbE2e.KeyWatch]::Events() -join ' / '))"
}

# Why a case does not run on this machine, or $null when it runs. A conditional case (Needs) does not
# run where what it needs is missing. A case that would act on a window a person or an aborted run left
# (SkipIf) does not run on a developer's desktop; under CI (OMB_E2E_CI) the desktop must be clean, so
# that fails the case instead: a dirty agent shows.
function Get-E2eSkipReason {
    param($Case, [string]$Lang)
    if ($Case.Only -and $Case.Only -ne $Lang) { return "runs against the $($Case.Only) macropad only: $($Case.Why)" }
    if ($Case.Needs -and -not (& $Case.Needs.Met)) { return "conditional: $($Case.Needs.Why)" }
    # An earlier case did not leave what this one starts from (it failed, was skipped or did not run).
    if ($Case.Prior) { $why = & $Case.Prior; if ($why) { return "not run: $why" } }
    if ($Case.SkipIf) {
        $why = & $Case.SkipIf
        if ($why) {
            if ($env:OMB_E2E_CI -eq '1') { throw "The CI desktop is not clean: $why." }
            return $why
        }
    }
    $null
}

# ---------------------------------------------------------------------------------------------------
# The account of a failed case: what the keyboard and the desktop were when it failed, read before the
# case's clean-up lets go of any key (Clear-E2eHeldKeys) or closes anything, and printed with the
# failure. A failure says what was wrong; this says what state the machine was in, which a failure that
# happens only now and then cannot be asked again. It only reads, and it attaches to no other thread's
# input: an attach resets the key state that thread reads, the very state a task switcher left in front
# may be waiting on.

# The commands whose cases run with the key watch's foreground hook on, and print, passed or failed, how
# their Alt+Tab went out (Get-E2eChordTimes). Every other case runs without that hook.
$script:E2eTimedCommands = @('NextWindow')

# The keys the account reads: Alt, Ctrl, Shift and Win on each side, Tab, the case's own macro key (Slot)
# and Fn. Pure.
function Get-E2eAccountKeys {
    param([int]$Slot)
    $keys = @(
        @{ Name = 'LAlt'; Vk = 0xA4 }, @{ Name = 'RAlt'; Vk = 0xA5 }, @{ Name = 'LCtrl'; Vk = 0xA2 }, @{ Name = 'RCtrl'; Vk = 0xA3 },
        @{ Name = 'LShift'; Vk = 0xA0 }, @{ Name = 'RShift'; Vk = 0xA1 }, @{ Name = 'LWin'; Vk = 0x5B }, @{ Name = 'RWin'; Vk = 0x5C }, @{ Name = 'Tab'; Vk = 0x09 })
    if ($Slot -gt 0) { $keys += @{ Name = "F$(12 + $Slot) (the case's key)"; Vk = $script:E2eFirstKeyVk + $Slot - 1 } }
    $keys + @(@{ Name = 'F24 (Fn)'; Vk = $script:E2eFnVk })
}

# The account's keys that Windows has down now (GetAsyncKeyState), in words: their names, or 'none'.
function Get-E2eKeysDownText {
    param([int]$Slot)
    $down = @(Get-E2eAccountKeys $Slot | Where-Object { ([Macropad.Native]::GetAsyncKeyState($_.Vk) -band 0x8000) -ne 0 } | ForEach-Object { $_.Name })
    if ($down.Count -gt 0) { $down -join ', ' } else { 'none' }
}

# One key line of the key watch's record (its fields, split at the tabs) in words: down or up, the key's
# name and its tag (untagged: the test's own keys, as a keyboard's; MPAD: the PowerShell macropad's, or
# the harness's activation, which taps Alt with the same tag; another tag: AutoHotkey's own). Pure.
function ConvertTo-E2eRecordKeyText {
    param([string[]]$Fields)
    $names = @{ 0x09 = 'Tab'; 0x0D = 'Enter'; 0x10 = 'Shift'; 0x11 = 'Ctrl'; 0x12 = 'Alt'; 0x1B = 'Escape'; 0x5B = 'LWin'; 0x5C = 'RWin'; 0xA0 = 'LShift'; 0xA1 = 'RShift'; 0xA2 = 'LCtrl'; 0xA3 = 'RCtrl'; 0xA4 = 'LAlt'; 0xA5 = 'RAlt' }
    $vk = [Convert]::ToInt32($Fields[3], 16)
    $name = if ($names.ContainsKey($vk)) { $names[$vk] } elseif ($vk -ge 0x7C -and $vk -le 0x87) { "F$($vk - 0x7C + 13)" } else { 'vk{0:X2}' -f $vk }
    $tag = [Convert]::ToInt64($Fields[4], 16)
    $who = if ($tag -eq 0) { 'untagged' } elseif ($tag -eq 0x4D504144) { 'MPAD' } else { 'tag {0:X}' -f $tag }
    "$($Fields[2]) $name $who"
}

# The key watch's timed record (KeyWatch.Timed lines) as one run of text: every injected key and every
# window that came in front, in the record's order, each with its time in ms from RefMs on the record's
# clock (+ after it, - before it). A key: down or up, its name and its tag (ConvertTo-E2eRecordKeyText).
# A window: its title, its program (Exes: program by process id) and its class. More than Max entries are
# cut in the middle; 'nothing' when there is none. Pure.
function Format-E2eRecord {
    param([string[]]$Lines = @(), [double]$RefMs, [hashtable]$Exes = @{}, [int]$Max = 40)
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    $all = [System.Collections.Generic.List[string]]::new()
    foreach ($line in @($Lines)) {
        $f = "$line" -split "`t"
        if ($f.Count -lt 5 -or $f[0] -notin 'key', 'front') { continue }
        $at = [math]::Round([double]::Parse($f[1], $culture) - $RefMs, 1)
        $time = $(if ($at -ge 0) { '+' } else { '-' }) + [math]::Abs($at).ToString('0.0', $culture)
        if ($f[0] -eq 'key') { $all.Add("$time $(ConvertTo-E2eRecordKeyText $f)"); continue }
        $exe = $Exes[[int]$f[2]]
        if (-not $exe) { $exe = "pid $($f[2])" }
        $all.Add("$time front '$($f[4])' ($exe, $($f[3]))")
    }
    $shown = $all.ToArray()
    if ($shown.Count -gt $Max) {
        # The first ten (the case's start) and the last ones (up to the failure).
        $shown = @($shown[0..9]) + @("... $($shown.Count - $Max) more ...") + @($shown[($shown.Count - $Max + 10)..($shown.Count - 1)])
    }
    if ($shown.Count -gt 0) { $shown -join ', ' } else { 'nothing' }
}

# The account's line of the key watch's record (Format-E2eRecord): its times count from the key going down
# (PressMs), or, when no key went down, from the record's first line. It says what a time means and,
# unless Watched (the foreground hook was on), why the record has no window that came in front after the
# one in front when it began: Timed, the case is one that turns the hook on, so turning it on failed.
# Pure.
function Format-E2eAccountRecord {
    param([string[]]$Lines = @(), $PressMs, [bool]$Watched, [bool]$Timed, [hashtable]$Exes = @{})
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    if ($null -ne $PressMs) {
        $from = 'ms after the key went down'
        $ref = [double]$PressMs
    } else {
        $from = 'ms after the record began, as no key went down'
        $first = @(@($Lines) | Where-Object { "$_" -match "^(key|front)`t" } | Select-Object -First 1)
        $ref = if ($first.Count -gt 0) { [double]::Parse(("$($first[0])" -split "`t")[1], $culture) } else { 0 }
    }
    $fronts = if ($Watched) { 'a window that came in front: when the key watch was told of it, an upper bound' }
    elseif ($Timed) { 'the only window is the one in front when the record began, as the foreground hook, which this case turns on, could not be turned on (said before the case''s lines)' }
    else { "the only window is the one in front when the record began, as the foreground hook runs only during the cases of $($script:E2eTimedCommands -join ', ')" }
    "  the key watch's record, in the order it got them ($from; a key: when the key watch saw it; $fronts): $(Format-E2eRecord $Lines $ref $Exes)"
}

# The program of each process id that the record's front lines name, for Format-E2eRecord.
function Get-E2eRecordExes {
    param([string[]]$Lines)
    $exes = @{}
    foreach ($line in @($Lines)) {
        $f = "$line" -split "`t"
        if ($f[0] -eq 'front' -and $f.Count -ge 5 -and -not $exes.ContainsKey([int]$f[2])) { $exes[[int]$f[2]] = [System.IO.Path]::GetFileName([Macropad.WindowApi]::ProcessPath([int]$f[2])) }
    }
    $exes
}

# When a command's Alt+Tab went out, as the key watch saw it (KeyWatch.Timed lines): its Alt down, Tab
# down, Tab up and Alt up, in ms after PressMs (the key's press, on the record's clock), the three gaps
# between them, and how long Alt was down. The command's keys are told from the others by tag and time:
# the test's own keys (the macro key, Escape, a key let go) go untagged; a macropad tags what it sends
# (MPAD, or AutoHotkey's own value); the harness's activation also taps Alt tagged MPAD, but only while it
# makes a window active, before the press. So: the first tagged Alt down after the press, then the first
# tagged Tab down after that, the Tab up after that, the Alt up after that. Also when the test let go of
# the macro key (its first untagged F13 to F23 up after the press), which may fall among the command's
# keys when the command is slow to start; the AutoHotkey macropad's hook takes that key before the key
# watch sees it. What was not seen is $null. Pure.
function Get-E2eChordTimes {
    param([string[]]$Lines, [double]$PressMs)
    $culture = [System.Globalization.CultureInfo]::InvariantCulture
    $seen = @{ AltDown = $null; TabDown = $null; TabUp = $null; AltUp = $null; KeyUp = $null }
    foreach ($line in @($Lines)) {
        $f = "$line" -split "`t"
        if ($f[0] -ne 'key' -or $f.Count -lt 5) { continue }
        $at = [double]::Parse($f[1], $culture) - $PressMs
        if ($at -lt 0) { continue }
        $vk = [Convert]::ToInt32($f[3], 16)
        $down = $f[2] -eq 'down'
        if ([Convert]::ToInt64($f[4], 16) -eq 0) {
            if ($null -eq $seen.KeyUp -and $vk -ge 0x7C -and $vk -le 0x86 -and -not $down) { $seen.KeyUp = $at }
            continue
        }
        $alt = $vk -eq 0x12 -or $vk -eq 0xA4 -or $vk -eq 0xA5
        if ($null -eq $seen.AltDown) { if ($alt -and $down) { $seen.AltDown = $at } }
        elseif ($null -eq $seen.TabDown) { if ($vk -eq 0x09 -and $down) { $seen.TabDown = $at } }
        elseif ($null -eq $seen.TabUp) { if ($vk -eq 0x09 -and -not $down) { $seen.TabUp = $at } }
        elseif ($null -eq $seen.AltUp) { if ($alt -and -not $down) { $seen.AltUp = $at } }
    }
    $span = { param($from, $to) if ($null -ne $from -and $null -ne $to) { [math]::Round($to - $from, 1) } }
    $round = { param($v) if ($null -ne $v) { [math]::Round($v, 1) } }
    [pscustomobject]@{
        AltDown = & $round $seen.AltDown; TabDown = & $round $seen.TabDown; TabUp = & $round $seen.TabUp; AltUp = & $round $seen.AltUp; KeyUp = & $round $seen.KeyUp
        AltToTab = & $span $seen.AltDown $seen.TabDown; TabHeld = & $span $seen.TabDown $seen.TabUp; TabToAltUp = & $span $seen.TabUp $seen.AltUp; AltHeld = & $span $seen.AltDown $seen.AltUp
    }
}

# One press's Alt+Tab (Get-E2eChordTimes) in words, for one line of the log. Pure.
function Format-E2eChordTimes {
    param($Times)
    if ($null -eq $Times -or $null -eq $Times.AltDown) { return 'the key watch saw no Alt down of the command after the key went down' }
    $v = { param($x) if ($null -ne $x) { "$x" } else { '-' } }
    $at = { param($x) if ($null -ne $x) { "+$x" } else { 'not seen' } }
    "Alt down $(& $at $Times.AltDown), Tab down $(& $at $Times.TabDown), Tab up $(& $at $Times.TabUp), Alt up $(& $at $Times.AltUp) ms after the key went down (the key went up $(& $at $Times.KeyUp)); Alt down to Tab down $(& $v $Times.AltToTab), Tab held $(& $v $Times.TabHeld), Tab up to Alt up $(& $v $Times.TabToAltUp), Alt held $(& $v $Times.AltHeld) ms"
}

# The account of a failed case, as labelled lines for the console: the keys Windows has down, the window
# in front at the press and now, the key watch's record (Format-E2eAccountRecord), the pointer and the
# visible top-level windows. With -AfterCleanUp, one line: the window in front and the keys down once the
# case's clean-up has run. It only reads. Never throws: a part that cannot be read says so.
function Get-E2eFailureState {
    param($ctx, [switch]$AfterCleanUp)
    $slot = [int]$ctx.Case.Slot
    $read = { param([scriptblock]$Do) try { & $Do } catch { "could not be read ($($_.Exception.Message))" } }
    $describe = {
        param([IntPtr]$Hwnd)
        if ($Hwnd -eq [IntPtr]::Zero) { return 'no window' }
        if (-not [Macropad.WindowApi]::Exists($Hwnd)) { return "a window that no longer exists ($Hwnd)" }
        Get-E2eWindowText $Hwnd
    }
    if ($AfterCleanUp) {
        return "  after the clean-up: in front $(& $read { & $describe ([Macropad.WindowApi]::Foreground()) }); keys down: $(& $read { Get-E2eKeysDownText $slot })"
    }
    $down = & $read { Get-E2eKeysDownText $slot }
    $frontNow = & $read { & $describe ([Macropad.WindowApi]::Foreground()) }
    $fronts = if ($null -ne $ctx.PressFront) { "when the key went down $(& $read { & $describe $ctx.PressFront }); now $frontNow" } else { "now $frontNow (no key went down)" }
    $record = & $read {
        $lines = @([OmbE2e.KeyWatch]::Timed())
        Format-E2eAccountRecord $lines $ctx.PressMs ([OmbE2e.KeyWatch]::WatchesFront) ($script:E2eTimedCommands -contains $ctx.Case.Command) (Get-E2eRecordExes $lines)
    }
    if ($record -like 'could not be read*') { $record = "  the key watch's record $record" }
    $pointer = & $read { $m = [OmbE2e.Input]::MousePosition(); "$($m[0]),$($m[1]), over $(& $describe ([OmbE2e.Input]::TopWindowAt($m[0], $m[1])))" }
    $windows = & $read {
        $shown = @(foreach ($h in [Macropad.WindowApi]::TopLevel()) { if ([Macropad.WindowApi]::Visible($h) -and -not [OmbE2e.Dwm]::Cloaked($h)) { $h } })
        $text = @($shown | Select-Object -First 12 | ForEach-Object { & $describe $_ }) -join '; '
        if ($shown.Count -gt 12) { $text += "; and $($shown.Count - 12) more" }
        $text
    }
    @(
        'The state at the failure, read before the clean-up let go of any key:'
        "  keys down, as Windows has them now (GetAsyncKeyState): $down"
        "  (keys read: Alt, Ctrl, Shift and Win on each side, Tab, the case's own key, F24 (Fn))"
        "  window in front: $fronts"
        $record
        "  pointer: $pointer"
        "  visible windows, top first: $windows"
    ) -join "`n"
}

# Runs one case against the macropad under test. Returns $null when it ran, or the reason it did not
# (the run lists those at its end): one known before it starts (Get-E2eSkipReason), or one that only
# running it can show, which its Assert leaves in $ctx.NotRun (a condition of the machine that the
# case measures as it runs). Before the macro key is pressed, the window the case named must
# still be in front; when it is not, nothing is pressed and the case fails. Under -Ci only, a failure
# after the press is tried once more when a window the run did not open had taken the focus; the
# second try checks the front again before it presses. A failure also says what the keyboard and the
# desktop were (Get-E2eFailureState). A case of a timed command (E2eTimedCommands) runs with the key
# watch's foreground hook on and prints how its command's Alt+Tab went out, passed or failed.
function Invoke-E2eCase {
    param([Parameter(Mandatory)]$Case, [Parameter(Mandatory)][string]$Lang)
    Assert-E2eTime
    $why = Get-E2eSkipReason $Case $Lang
    if ($why) { $script:E2eRun.NotRun.Add("$Lang $($Case.Name): $why"); return $why }
    if ($Case.Kind -eq 'Watch') { $arrange = $script:E2eWatchArrange; $assert = $script:E2eWatchAssert; $Case.Swallow = $true }
    else { $arrange = $script:E2eChordArrange; $assert = $script:E2eChordAssert }
    if ($Case.Arrange) { $arrange = $Case.Arrange }
    if ($Case.Assert) { $assert = $Case.Assert }
    $script:E2eRun.Case = "$Lang $($Case.Name)"  # for the list of waits that came close to their limit
    [void](Use-E2eMacropad $Lang $Case.Chunk)
    $timed = $script:E2eTimedCommands -contains $Case.Command
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $ctx = @{ Case = $Case; Lang = $Lang; Run = $script:E2eRun; Pressed = $false }
        $failure = $null
        $failureText = $null
        $foreign = $null
        $state = $null
        $record = $null
        # What the clean-up after the case could not do: every step of it runs whatever the one before
        # did, and a step that fails is reported beside the case's own failure, never in its place.
        $problems = [System.Collections.Generic.List[string]]::new()
        try {
            Select-E2eLayer $Case.Layer
            $errorsBefore = @(Get-E2eErrorLines).Count
            [OmbE2e.KeyWatch]::Clear()
            if ($timed -and -not [OmbE2e.KeyWatch]::WatchFront($true)) {
                Write-Host "End-to-end $($Case.Command), $Lang, the case '$($Case.Name)': the foreground hook could not be turned on, so this case's record has no window that came in front."
            }
            $script:E2eRun.LastActivated = [IntPtr]::Zero
            & $arrange $ctx
            # The key goes into the window the case named: one its Arrange set as Front, or the last
            # one it made active; or, with FrontDesktop, the desktop itself. Never whatever is in front.
            if (-not $ctx.Front) { $ctx.Front = $script:E2eRun.LastActivated }
            [OmbE2e.KeyWatch]::Swallow = [bool]$Case.Swallow
            # The command log's length before the press: what the macropad ran for it comes after.
            $ctx.Commands = Get-E2eCommandMark
            Invoke-E2eCaseKey $ctx -FrontDesktop:([bool]$ctx.FrontDesktop)
            & $assert $ctx
            # The record the timing line reads, before the clean-up adds keys of its own.
            if ($timed) { $record = @([OmbE2e.KeyWatch]::Timed()) }
            Assert-E2eCaseLogs $ctx $errorsBefore
        } catch {
            $failure = $_
            if ($timed -and $null -eq $record) { $record = @([OmbE2e.KeyWatch]::Timed()) }
            # Read now, before the clean-up below lets go of any key or closes anything: what the
            # keyboard and the desktop were, and what the macropad's command log says at the failure.
            $state = try { Get-E2eFailureState $ctx } catch { "The state at the failure could not be read: $($_.Exception.Message)" }
            $failureText = Get-E2eFailureText $failure.Exception.Message $ctx
            $foreign = Get-E2eForeignForeground $Case
        } finally {
            [OmbE2e.KeyWatch]::Swallow = $false
            if ($timed -and -not [OmbE2e.KeyWatch]::WatchFront($false)) {
                Write-Host "End-to-end $($Case.Command), $Lang, the case '$($Case.Name)': the foreground hook could not be turned off within 2 s; the key watch's thread was busy, and the hook goes off when it gets to the message."
            }
            $step = { param([scriptblock]$Do) try { & $Do } catch { $problems.Add($_.Exception.Message) } }
            & $step { Clear-E2eHeldKeys }
            & $step { if ($Case.CleanUp) { & $Case.CleanUp $ctx } }
            # A form or message box of the macropad's that the case left open would stand in the way
            # of the next case: it is closed, and the case fails (unless it failed already).
            $left = Get-E2eMacropadWindows -Others  # already a list
            if ($left.Count -gt 0 -and -not $failure) { $problems.Add("the macropad still showed $($left.Count) window(s): $(($left | ForEach-Object { "'$([Macropad.WindowApi]::Title($_))'" }) -join ', ')") }
            foreach ($w in $left) { & $step { Close-E2eWindow $w } }
        }
        if ($failure) { $state = "$state`n$(try { Get-E2eFailureState $ctx -AfterCleanUp } catch { "  after the clean-up: could not be read ($($_.Exception.Message))" })" }
        # How the command's Alt+Tab went out, passed or failed, from the record read before the clean-up.
        if ($timed -and $ctx.Pressed -and $null -ne $ctx.PressMs) {
            $outcome = if ($failure) { 'failed' } else { 'passed' }
            Write-Host "End-to-end $($Case.Command) timing, $Lang, the case '$($Case.Name)' ($outcome): $(try { Format-E2eChordTimes (Get-E2eChordTimes $record $ctx.PressMs) } catch { "could not be read ($($_.Exception.Message))" })"
        }
        # Only under -Ci, where nobody is at the desktop, is a case tried again after another window
        # took the focus; on a developer's desktop the case fails, saying what was in front.
        if ($failure -and $problems.Count -eq 0 -and $attempt -eq 1 -and $env:OMB_E2E_CI -eq '1' -and $ctx.Pressed -and $foreign -and $failure.Exception.Message -notlike 'Not pressed:*') {
            Write-Host "End-to-end: $($Case.Name) failed while $foreign had the focus, a window the test did not open; trying once more. The failure was: $($failure.Exception.Message)`n$state"
            continue
        }
        # A failure after the press says what the macropad's command log says of the case's command:
        # never started, not finished, finished (so what is missing is its effect), or failed. Every
        # failure says what the keyboard and the desktop were (Get-E2eFailureState).
        if ($problems.Count -eq 0) {
            if ($failure) {
                # A text thrown here would point at this line: it says where the case failed.
                throw "$failureText`n$state`n$($failure.InvocationInfo.PositionMessage)"
            }
            if ($ctx.NotRun) { $script:E2eRun.NotRun.Add("$Lang $($Case.Name): $($ctx.NotRun)") }
            return $ctx.NotRun
        }
        $text = "The clean-up after $($Case.Name) had problems: $($problems -join '; ')"
        if ($failure) { $text = "$failureText`n$state`n$text" }
        throw $text
    }
}

# ---------------------------------------------------------------------------------------------------
# The end of the run, also after a failure or after its time limit: the limit no longer applies, and
# every step runs whatever the one before did. The run stops what only it can stop (its key watch, the
# macropad under test through that macropad's own exit key) and lists the cases that did not run.
# Everything else is in its state file, and the one clean-up below carries that out, as it does after
# a run that did not end itself.

function Complete-E2eRun {
    $r = $script:E2eRun
    if ($null -eq $r) { return }
    $r.Deadline = [DateTime]::MaxValue
    # First, the state file says that the run's own clean-up has begun: the banner then gives it five
    # minutes more before it ends the test.
    $r.CleanupStarted = $true
    Write-E2eState
    $problems = [System.Collections.Generic.List[string]]::new()
    $step = { param([string]$What, [scriptblock]$Do) try { & $Do } catch { $problems.Add("$What`: $($_.Exception.Message)") } }
    & $step 'stopping the key watch' { [OmbE2e.KeyWatch]::Stop() }
    & $step 'letting go of held keys' { Clear-E2eHeldKeys }
    & $step 'stopping the macropad under test' { Stop-E2eMacropad }
    if ($r.NotRun.Count -gt 0) { Write-Host ("End-to-end: cases that did not run:`n  " + ($r.NotRun -join "`n  ")) }
    if ($r.SlowWaits.Count -gt 0) { Write-Host ("End-to-end: waits that were met only after two thirds of their limit (a slower run could pass that limit):`n  " + ($r.SlowWaits -join "`n  ")) }
    # The test leaves the run's folder, where it worked, so that the folder can be removed.
    & $step 'leaving the run''s folder' { $temp = [OmbE2e.ProcessInfo]::LongPath([System.IO.Path]::GetTempPath()); Set-Location -LiteralPath $temp; [Environment]::CurrentDirectory = $temp }
    $script:E2eRun = $null
    & $step 'the clean-up' { foreach ($p in (Clear-E2eLeftovers -Ended $r.Dir).Problems) { $problems.Add($p) } }
    if ($problems.Count -gt 0) { throw ("The end-to-end clean-up had problems: " + ($problems -join '; ')) }
}

# ---------------------------------------------------------------------------------------------------
# The one clean-up: of a run at its own end (Complete-E2eRun), and of runs that did not end themselves
# (a crash, a Jenkins abort). `run.ps1 -EndToEndCleanup` runs it (the Jenkins stage before and after
# every run, whatever happened; the banner when the test is gone), and every run does at its start.
#
# A run folder (omb-e2e-<pid> in TEMP) is a leftover when the test it names in its state file (pid and
# start time) no longer runs; a test whose start cannot be read counts as running. Its state file is
# believed only as far as it can be checked: a process is ended only when its pid and start time are
# still those recorded; a window is closed only when its handle, process, that process's start and
# class still match; a virtual desktop is closed by its id. What cannot be checked (a start time that
# cannot be read) is left alone, and that is a problem. A process that runs from the run's folder or
# works in it (a program the test or a macropad under test started and that outlived its window) is
# the run's by where it is and when it started, after the run's test did: it is ended, and the
# clean-up says which. Under Jenkins the same holds for the workspace and an earlier build
# (Clear-E2eWorkspace). Of a folder from before Windows last started,
# no process or window it names is touched (they ended with Windows): the macropads it stopped are
# started again, a virtual desktop it names that is still there is a problem, and the folder goes. A
# step that fails is a problem and its line stays in the state file, so the next clean-up tries again.
# What a clean-up cleared is done, not a problem, whichever run left it. The folder, and with it the
# record, goes in one place, and only when nothing is left. One clean-up at a time works on a folder
# (a lock file beside it, omb-e2e-<pid>.lock, held until the folder is done or gone): another waits
# for it, then looks again. Whenever a step changes the screen a banner is up, and every such change
# is paced. Returns @{ Done; Problems }: what was done, and what was not.

function Get-E2eStateLines {
    param([string]$Dir)
    $state = Join-Path $Dir 'state.txt'
    if (-not (Test-Path -LiteralPath $state)) { return , @() }
    , @(Get-Content -LiteralPath $state)
}

# The test a run folder belongs to still runs: its pid and start time from the state file, else the pid
# in the folder's name.
function Test-E2eRunAlive {
    param([string]$Dir, [string[]]$Lines)
    foreach ($line in $Lines) {
        if ($line -match '^test (\d+) (\d+)') {
            $p = Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue
            if (-not $p) { return $false }
            # A process whose start cannot be read (an elevated test seen from a shell that is not)
            # counts as alive: nothing of a run is touched on a guess.
            try { return $p.StartTime.ToUniversalTime().Ticks -eq [long]$Matches[2] } catch { return $true }
        }
    }
    # No state yet (a run that was making its folder): its name says the pid, alone.
    if ((Split-Path $Dir -Leaf) -match '^omb-e2e-(\d+)$') { return [bool](Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue) }
    $false
}

# Takes a run folder's clean-up lock, a file beside the folder that is deleted when its handle closes:
# one clean-up at a time works on a folder, and holds the lock until the folder is done or removed.
# While another clean-up holds it, this one waits, up to TimeoutMs, and once it has the lock it looks
# again: the holder may have removed the folder. A lock file that no process holds is one a clean-up
# left when it died (a power loss): it is cleared, and that is reported. The lock's stream, or $null
# when the folder is gone or the lock stayed held.
function Lock-E2eFolder {
    param([string]$Dir, [System.Collections.Generic.List[string]]$Problems, [int]$TimeoutMs = 180000)
    $path = "$Dir.lock"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        if (-not (Test-Path -LiteralPath $Dir)) { return $null }
        $lock = $null
        try { $lock = [System.IO.FileStream]::new($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::DeleteOnClose) } catch { }
        if ($null -ne $lock) {
            if (Test-Path -LiteralPath $Dir) { return $lock }
            $lock.Dispose()
            return $null
        }
        # Held, a delete fails (the holder shares nothing); not held, the file was left by a dead clean-up.
        try {
            Remove-Item -LiteralPath $path -Force -ErrorAction Stop
            $Problems.Add("$(Split-Path $Dir -Leaf): a clean-up lock that no clean-up held (one ended by a crash or a power loss) was cleared")
            continue
        } catch { }
        if ($sw.ElapsedMilliseconds -ge $TimeoutMs) { return $null }
        Wait-Pump 500
    }
}

# Before a clean-up changes the screen, a banner is up: the run's own, or the one that started this
# clean-up and waits for it, or else one shown here, which Clear-E2eLeftovers ends when it is through.
function Show-E2eCleanupBanner {
    if ((Find-Window $script:E2eBannerWindow) -eq [IntPtr]::Zero) { $script:E2eCleanupBanner = Start-E2eBanner }
}

# Under Jenkins only (run.ps1 -EarlierBuilds decides): what an earlier build of the job left in the
# workspace. A process that runs from the workspace or works in it, that started before this clean-up
# did and is neither this process nor one it descends from (the build's own steps), cannot be this
# stage's: an earlier build left it, or an earlier stage of this build that ran in the same workspace
# (the Pester stage, on the same machine). It is listed with all that says which case started it, ended, and done: this build is not
# failed for what it has just cleared. One whose start cannot be read, or that cannot be ended, is a
# problem. Never on a developer's desktop: there the checkout is a person's folder, and their shells
# stand in it.
function Clear-E2eWorkspace {
    param([string]$Workspace, [System.Collections.Generic.List[string]]$Done, [System.Collections.Generic.List[string]]$Problems)
    $mine = Get-E2eStartTicks $PID
    $found = @(Get-E2eRunProcesses $Workspace -OrWorkingIn)
    $earlier = @($found | Where-Object { $_.StartTicks -ne 0 -and $mine -ne 0 -and $_.StartTicks -lt $mine }).Count
    # Left by an earlier build, or by an earlier stage of this one in the same workspace (the Pester
    # stage on the same machine): what started before this clean-up did is not this stage's.
    Write-Host "End-to-end clean-up: $earlier process(es) in the workspace $Workspace that started before this clean-up did (running from it or working in it, this build's own steps left out), $($found.Count - $earlier) other(s) found there."
    foreach ($p in $found) {
        $what = Get-E2eProcessText $p
        if ($p.StartTicks -eq 0 -or $mine -eq 0) { $Problems.Add("in the workspace, left alone because it cannot be told when it started: $what"); continue }
        if ($p.StartTicks -ge $mine) { continue }
        try {
            Show-E2eCleanupBanner
            Wait-ScreenChange
            Stop-E2eCleanupProcess $p.ProcessId
            $Done.Add("ended what was left in the workspace before this clean-up started: $what")
        } catch { $Problems.Add("it was left in the workspace before this clean-up started, and it could not be ended ($($_.Exception.Message)): $what") }
    }
}

# Ends the process Id by force and waits up to TimeoutMs for it to be gone. Throws when Windows refuses
# the end, and when the process still runs at the limit: a clean-up says "ended" only of what is gone,
# and lists anything else as not done.
function Stop-E2eCleanupProcess {
    param([Parameter(Mandatory)][int]$Id, [int]$TimeoutMs = 5000)
    Stop-Process -Id $Id -Force -ErrorAction Stop
    if (-not (Wait-E2eCondition { -not (Get-Process -Id $Id -ErrorAction SilentlyContinue) } -TimeoutMs $TimeoutMs)) {
        throw "it was still running $TimeoutMs ms after it was told to end"
    }
}

# Cleans up every leftover run folder; with Ended, only that folder, the one of the run that calls this
# at its own end. With Workspace (a Jenkins build's), first what an earlier build left there.
function Clear-E2eLeftovers {
    param([string]$Ended = '', [string]$Workspace = '')
    $done = [System.Collections.Generic.List[string]]::new()
    $problems = [System.Collections.Generic.List[string]]::new()
    $script:E2eCleanupBanner = 0
    if ($Ended) { $dirs = @(Get-Item -LiteralPath $Ended -ErrorAction SilentlyContinue) }
    else {
        $temp = [OmbE2e.ProcessInfo]::LongPath([System.IO.Path]::GetTempPath())
        $dirs = @(Get-ChildItem -LiteralPath $temp -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^omb-e2e-\d+(-\d+)?$' })
    }
    try {
        if ($Workspace) { Clear-E2eWorkspace $Workspace $done $problems }
        foreach ($dir in $dirs) {
            if (-not $Ended -and (Test-E2eRunAlive $dir.FullName (Get-E2eStateLines $dir.FullName))) { continue }
            $lock = Lock-E2eFolder $dir.FullName $problems
            if ($null -eq $lock) {
                if (Test-Path -LiteralPath $dir.FullName) { $problems.Add("$($dir.Name): another clean-up still held it after 3 minutes; nothing was done") }
                continue
            }
            try { Clear-E2eFolder $dir.FullName $done $problems -Ended:([bool]$Ended) } finally { $lock.Dispose() }
        }
    } finally {
        if ($script:E2eCleanupBanner) { Wait-ScreenChange; Stop-Process -Id $script:E2eCleanupBanner -Force -ErrorAction SilentlyContinue }
    }
    foreach ($d in $done) { Write-Host "End-to-end clean-up: $d" }
    foreach ($p in $problems) { Write-Host "End-to-end clean-up, not done: $p" }
    @{ Done = $done.ToArray(); Problems = $problems.ToArray() }
}

# Carries out one run folder's state file, under its lock, and removes the folder when nothing is left.
# Each line is done (what it names was ended, closed or started, or is no longer the run's) or left;
# the state file then keeps only the lines that are left. The state is read here, under the lock, since
# the clean-up that held the lock before may have done part of it. Ended says that the folder is the
# calling run's own, at its end; any other folder is carried out only when its test no longer runs.
function Clear-E2eFolder {
    param([string]$Dir, [System.Collections.Generic.List[string]]$Done, [System.Collections.Generic.List[string]]$Problems, [switch]$Ended)
    $name = Split-Path $Dir -Leaf
    $lines = Get-E2eStateLines $Dir  # already a list
    if (-not $Ended -and (Test-E2eRunAlive $Dir $lines)) { return }
    $header = @($lines | Where-Object { $_ -match '^(test|boot) ' })
    $boot = Get-E2eBootTicks
    $sameBoot = $false
    foreach ($line in $header) { if ($line -match '^boot (\d+)$') { $sameBoot = [math]::Abs([long]$Matches[1] - $boot) -lt 600000000 } }  # within a minute
    # A folder with no state names nothing (a run that ended while it made its folder): it only goes.
    if ($lines.Count -gt 0 -and -not $sameBoot) {
        # No process or window it names is touched: after a restart a pid, a handle or a start time
        # says nothing, and what they named ended with Windows. A virtual desktop outlives a restart,
        # and so does the duty to start again a macropad the run stopped.
        if (@($header | Where-Object { $_ -match '^boot \d+$' }).Count -gt 0) { $Done.Add("${name}: left by a run from before Windows last started; the processes and windows it names ended with Windows and were not touched") }
        else { $Problems.Add("${name}: its state does not say when Windows had started, so it cannot be told whether the processes and windows it names still run; they were not touched, and the folder is removed") }
        $desktops = Get-E2eDesktops
        foreach ($line in $lines) {
            if ($line -match '^desktop ([0-9a-f]{32})$' -and $desktops -contains $Matches[1]) { $Problems.Add("${name}: the virtual desktop $($Matches[1]) that run made is still there; close it by hand (Win+Ctrl+F4 on it)") }
        }
        $lines = @($lines | Where-Object { $_ -match '^run ' })
    }
    $left = [System.Collections.Generic.List[string]]::new()
    $try = {
        param([string]$Line, [string]$Label, [scriptblock]$Do)
        try { & $Do } catch { $Problems.Add("${name}: $Label`: $($_.Exception.Message)"); $left.Add($Line) }
    }
    # Whether the process Id is still the one that started at Start, as the state file says. One that
    # is gone is not. One whose start time cannot be read, now or when the run recorded it, cannot be
    # told from another process: that throws, so the step is a problem and its line stays.
    $match = {
        param([int]$Id, [long]$Start)
        $now = Get-E2eStartTicks $Id
        if ($now -eq 0 -and -not (Get-Process -Id $Id -ErrorAction SilentlyContinue)) { return $false }
        if ($now -eq 0 -or $Start -eq 0) { throw "the start time of process $Id cannot be read, so it cannot be told whether it is the run's; it is left alone" }
        $now -eq $Start
    }
    $end = {
        param([string]$Line, [string]$What, [int]$Id, [long]$Start)
        & $try $Line "ending $What $Id" {
            if (& $match $Id $Start) {
                Show-E2eCleanupBanner
                Wait-ScreenChange
                Stop-E2eCleanupProcess $Id
                $Done.Add("ended $What $Id")
            }
        }
    }
    foreach ($line in $lines) { if ($line -match '^kill (\d+) (\d+) (.+)$') { & $end $line $Matches[3] ([int]$Matches[1]) ([long]$Matches[2]) } }
    # The programs that run from the run's own folder (its copies of AutoHotkey, the launcher) or work
    # in it (what the test or a macropad under test started and nothing closed) are the run's own when
    # they started after the run's test did: while one lives, the folder cannot be removed. One that
    # was there before (a shell a person opened earlier and now stands in a kept folder) is not. Where
    # the state does not say when the test started, or says it for before Windows last started, none
    # is the run's.
    $testStart = [long]::MaxValue
    if ($sameBoot) { foreach ($line in $header) { if ($line -match '^test \d+ (\d+)') { $testStart = [long]$Matches[1] } } }
    $ours = { @(Get-E2eRunProcesses $Dir -OrWorkingIn | Where-Object { $_.StartTicks -gt $testStart }) }
    # Each is told to end, then all are waited for at once. Only one that is gone then is "ended"; one
    # that still runs is listed as not done by the check at the end of this function ("still running
    # after it was ended"), which also keeps the folder.
    $stopped = [System.Collections.Generic.List[object]]::new()
    foreach ($p in (& $ours)) {
        $what = Get-E2eProcessText $p
        & $try '' "ending $what" { Show-E2eCleanupBanner; Wait-ScreenChange; Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $stopped.Add([pscustomobject]@{ Id = $p.ProcessId; What = $what }) }
    }
    [void](Wait-E2eCondition { (& $ours).Count -eq 0 } -TimeoutMs 5000)
    $running = @((& $ours) | ForEach-Object { $_.ProcessId })
    foreach ($s in $stopped) { if ($running -notcontains $s.Id) { $Done.Add("ended $($s.What)") } }
    foreach ($line in $lines) {
        if ($line -match '^window (\d+) (\d+) (\d+) (.+)$') {
            $h = [IntPtr][long]$Matches[1]; $id = [int]$Matches[2]; $start = [long]$Matches[3]; $class = $Matches[4]
            & $try $line "closing window $h" {
                if ([Macropad.WindowApi]::Exists($h) -and [Macropad.WindowApi]::ProcessId($h) -eq $id -and [Macropad.WindowApi]::ClassName($h) -eq $class -and (& $match $id $start)) {
                    Show-E2eCleanupBanner
                    Close-E2eWindow $h
                    $Done.Add("closed window $h ($class)$(if ([Macropad.WindowApi]::Exists($h)) { '; its program still keeps it, hidden' })")
                }
            }
        }
    }
    foreach ($line in $lines) {
        if ($line -match '^desktop ([0-9a-f]{32})$') {
            $id = $Matches[1]
            & $try $line "closing the virtual desktop $id" {
                if ((Get-E2eDesktops) -contains $id) {
                    Show-E2eCleanupBanner
                    if (-not (Close-E2eDesktop $id)) { throw 'it could not be reached or did not close' }
                    $Done.Add("closed the virtual desktop $id")
                }
            }
        }
    }
    & $try '' 'letting go of held keys' { Clear-E2eHeldKeys }
    foreach ($line in $lines) {
        if ($line -match "^run ([^`t]+)`t([^`t]*)`t(.*)$") {
            $exe = $Matches[1]; $arguments = $Matches[2]; $cwd = $Matches[3]
            & $try $line "starting again $exe $arguments" {
                $result = Start-E2eRecordedMacropad $exe $arguments $cwd
                if ($result -eq 'failed') { throw "it did not start; start it by hand (in $cwd)" }
                $Done.Add("the macropad runs ($result): $exe $arguments")
            }
        }
    }
    # The run's banner goes last, so that it is up while the steps above change the screen. The banner
    # that started this clean-up waits for it, on the screen, and exits after it.
    $parent = [int](Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId
    foreach ($line in $lines) { if ($line -match '^banner (\d+) (\d+)$' -and [int]$Matches[1] -ne $parent) { & $end $line 'the banner' ([int]$Matches[1]) ([long]$Matches[2]) } }
    $keep = @($left | Where-Object { $_ })
    $there = @(Get-E2eRunProcesses $Dir -OrWorkingIn)
    $still = @($there | Where-Object { $_.StartTicks -gt $testStart })
    if ($still.Count -gt 0) { $Problems.Add("${name}: still running after it was ended: $(($still | ForEach-Object { Get-E2eProcessText $_ }) -join '; ')") }
    if ($keep.Count -gt 0 -or $still.Count -gt 0) {
        [System.IO.File]::WriteAllLines((Join-Path $Dir 'state.txt'), [string[]](@($header) + $keep))
        return
    }
    # The one place that deletes a run's record: nothing it names is left to do.
    try { Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction Stop; $Done.Add("removed $Dir") }
    catch {
        $others = @($there | Where-Object { $_.StartTicks -le $testStart } | ForEach-Object { Get-E2eProcessText $_ })
        $seen = if ($others.Count -gt 0) { "In the folder, and left alone because nothing says it is the run's (it did not start after the run's test did, or when either started cannot be read): $($others -join '; ')." } else { 'No process that runs from the folder or works in it can be seen from here.' }
        $Problems.Add("removing ${Dir}: $($_.Exception.Message) $seen What this clean-up cannot see or does not end: a process that has a file open in the folder, a process of another user or an elevated one, and the shell this clean-up was called from when it stands in the folder. The next clean-up tries again.")
    }
}
