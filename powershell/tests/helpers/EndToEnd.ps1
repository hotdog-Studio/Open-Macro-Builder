# The harness of the end-to-end test (EndToEnd.Tests.ps1): it makes the desktop the test's own, starts
# a real macropad, presses real keys with SendInput from this process, reads what happened, and puts
# everything back. Dot-source it after lib\Native.ps1, Interop.ps1, Pump.ps1, Input.ps1, AhkSyntax.ps1,
# WinTitle.ps1, WindowOps.ps1, Window.ps1 and the helpers Ahk.ps1 and CommandSource.ps1.
#
# The keys go through SendInput untagged, as a keyboard's would: not through [Macropad.Inject], whose
# tag the PowerShell macropad ignores, and not from an AutoHotkey script, whose input AutoHotkey's hook
# hotkeys ignore.

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
    }

    // A low-level keyboard hook on its own thread, for keys that Windows takes before any window gets
    // them (Win key chords, Print Screen, media keys). It records only injected keys (sent by a
    // program), never what a person types, and while Swallow is on it stops injected keys other than
    // F13 to F24 from reaching Windows, so a chord is seen without being carried out.
    public static class KeyWatch
    {
        private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);
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

        private static readonly HookProc proc = Callback;
        private static IntPtr hook = IntPtr.Zero;
        private static uint threadId;
        private static System.Threading.Thread thread;
        private static readonly System.Collections.Generic.List<string> events = new System.Collections.Generic.List<string>();
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
                    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
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
        public static void Clear() { lock (events) events.Clear(); }

        private static IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                bool injected = (k.flags & 0x10) != 0;
                bool up = (k.flags & 0x80) != 0;
                bool macroKey = k.vkCode >= 0x7C && k.vkCode <= 0x87;
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

        // null when it cannot be read (another user's process, a 32-bit process).
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
$script:E2eChangeClock = $null
$script:E2eWarning = 'Photosensitivity warning: this test opens, moves and closes windows. Look away if flashing affects you.'
# The banner's window (ahk\tests\e2e\banner.ahk), as Find-Window reads it.
$script:E2eBannerWindow = 'Open Macro Builder end-to-end test ahk_class AutoHotkeyGUI'
# Fn is F24 and the macro keys are F13 to F23 in the test's layouts: keys no keyboard in the room has.
$script:E2eFnVk = 0x87
$script:E2eFirstKeyVk = 0x7C
$script:E2eKeyCount = 11
# The keys a run may hold down: Shift, Ctrl, Alt (both sides), the Windows keys, and Fn.
$script:E2eHoldableVk = @(0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C, 0x87)
# The variables run.ps1 sets for the test: no program the test starts gets them.
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
# that; $null when TimeoutMs pass first.
function Wait-E2eCondition {
    param([Parameter(Mandatory)][scriptblock]$Condition, [int]$TimeoutMs = 5000, [int]$EveryMs = 50)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        Assert-E2eTime
        $value = & $Condition
        if ($null -ne $value -and $value -isnot [bool]) { return $value }
        if ($value -is [bool] -and $value) { return $true }
        if ($sw.ElapsedMilliseconds -ge $TimeoutMs) { return $null }
        Wait-Pump $EveryMs
    }
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

function Send-E2eClick {
    param([int]$X, [int]$Y, [ValidateSet('Left', 'Right')][string]$Button = 'Left')
    [void][OmbE2e.Input]::MoveMouse($X, $Y)
    Wait-Pump 30
    $flags = @{ Left = @(2, 4); Right = @(8, 16) }[$Button]
    [void][OmbE2e.Input]::Mouse($flags[0]); Wait-Pump 30; [void][OmbE2e.Input]::Mouse($flags[1])
}

# Lets go of Shift, Ctrl, Alt, the Windows keys and Fn where Windows says one is still down, so that a
# run that stopped in the middle of a chord leaves no key held for the person or the next build.
function Clear-E2eHeldKeys {
    foreach ($vk in $script:E2eHoldableVk) {
        if (([Macropad.Native]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { [void][OmbE2e.Input]::Key($vk, $true, (Test-ExtendedKey $vk)) }
    }
}

# Before a key is pressed into a window: that window must be the one in front. Nothing is pressed when
# it is not; the error says what was in front.
function Assert-E2eFront {
    param([IntPtr]$Hwnd, [string]$What = 'the window the case made active')
    $front = [Macropad.WindowApi]::Foreground()
    if ($front -ne $Hwnd) { throw "Not pressed: $What was not in front; $(Get-E2eForegroundText) was." }
}

# Under -Ci only (OMB_E2E_CI: nobody sits at that desktop), Windows' own shell may have come up by
# itself a moment after a case (Snap Assist after a snap, the desktop after a desktop switch) and taken
# the keyboard. Once, such a window of explorer.exe is put away (Escape, only while that overlay is in
# front) and Front is brought back, paced. On a developer's desktop nothing is taken back from a
# person: nothing happens here, and Assert-E2eFront refuses to press, saying what was in front.
function Restore-E2eFront {
    param([IntPtr]$Front)
    if ($env:OMB_E2E_CI -ne '1') { return }
    $fg = [Macropad.WindowApi]::Foreground()
    if ($fg -eq $Front) { return }
    $info = Get-WindowInfo $fg
    if ($info.Exe -ne 'explorer.exe' -or $info.Class -notin $script:E2eShellClasses) { return }
    Write-Host "End-to-end (CI): $(Get-E2eForegroundText) had the keyboard; it is put away once and the case's window brought back."
    if ($info.Class -eq 'XamlExplorerHostIslandWindow') {
        Wait-ScreenChange
        Send-E2eChordTo $fg 'Escape'
        [void](Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -ne $fg } -TimeoutMs 1500)
    }
    [void](Set-E2eActive $Front)
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
# goes into is never taken from whatever happens to be in front.
function Invoke-E2eCaseKey {
    param($ctx, [IntPtr]$Front = $ctx.Front, [int]$Slot = $ctx.Case.Slot, [switch]$FrontDesktop)
    Wait-ScreenChange
    if ($FrontDesktop) {
        if (-not (Test-E2eDesktopFront)) { throw "Not pressed: the desktop was not in front; $(Get-E2eForegroundText) was." }
    } else {
        if ($Front -eq [IntPtr]::Zero) { throw 'Not pressed: the case names no window to press into (no known front).' }
        if ([Macropad.WindowApi]::Foreground() -ne $Front) {
            Restore-E2eFront $Front
            Wait-ScreenChange  # the restore changed the screen; the press may change it again
        }
        Assert-E2eFront $Front
    }
    $ctx.Pressed = $true
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

# The processes running from a folder (the run's own: stand-ins, copies of AutoHotkey, the launcher).
# With -OrWorkingIn, also those whose working directory is in it: the macropads under test work in the
# run's copy, and a program one of them starts inherits that, so a program that outlives its window is
# found here, and keeps the folder from being removed until it has ended. This process and the ones it
# descends from never count (a clean-up called from a shell that stands in the folder). Each row has
# WorkingIn: that directory, or '' for a process that runs from the folder.
function Get-E2eRunProcesses {
    param([string]$Dir = $script:E2eRun.Dir, [switch]$OrWorkingIn)
    $prefix = $Dir.TrimEnd('\') + '\'
    $all = @(Get-CimInstance Win32_Process)
    $from = @($all | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) })
    foreach ($p in $from) { $p | Add-Member WorkingIn '' -Force }
    if (-not $OrWorkingIn) { return $from }
    $mine = @($PID)
    for ($i = 0; $i -lt 20; $i++) {
        $parent = @($all | Where-Object { [int]$_.ProcessId -eq $mine[-1] })[0]
        if (-not $parent -or $mine -contains [int]$parent.ParentProcessId) { break }
        $mine += [int]$parent.ParentProcessId
    }
    $from + @(foreach ($p in $all) {
            if ($from -contains $p -or $mine -contains [int]$p.ProcessId) { continue }
            $cwd = [OmbE2e.ProcessInfo]::CurrentDirectory([int]$p.ProcessId)
            if ($cwd -and ($cwd.TrimEnd('\') + '\').StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $p | Add-Member WorkingIn $cwd -Force -PassThru }
        })
}

# ---------------------------------------------------------------------------------------------------
# Windows that commands open.

# The windows that fit one entry of a case's WinTitle list: a WinTitle as Find-Window reads it, or
# 'app:<application id>' for the frame windows of a Store app (Settings, Calculator), whose titles are
# translated and whose application id is the same in every display language.
function Find-E2eWindows {
    param([string]$WinTitle, [switch]$IncludeHidden)
    if ($WinTitle -notlike 'app:*') { return , (Find-Window $WinTitle -All -IncludeHidden:$IncludeHidden) }
    , [IntPtr[]]@(foreach ($h in (Find-Window 'ahk_class ApplicationFrameWindow' -All -IncludeHidden:$IncludeHidden)) { if ((Get-WindowAppId $h) -eq $WinTitle.Substring(4)) { $h } })
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

function Wait-E2eMark {
    param([int]$Mark, [string]$Like, [int]$TimeoutMs = 10000)
    Wait-E2eCondition { Get-E2eMarks $Mark | Where-Object { $_ -like $Like } | Select-Object -First 1 } -TimeoutMs $TimeoutMs
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

# Closes a window a command opened (paced; with -Force its program is ended if it stays): the one way
# the test closes a window and decides whether it is gone, during a run and in the clean-up after one.
# A window is closed when it no longer exists: Calculator hides its window at once but may keep it for
# seconds more, so this waits up to 10 s. One that still exists stays in the run's list, and this
# throws, so that the run's end, or the clean-up after it, closes it.
function Close-E2eWindow {
    param([IntPtr]$Hwnd, [switch]$Force)
    if ([Macropad.WindowApi]::Exists($Hwnd)) {
        Wait-ScreenChange
        [void](Close-Window $Hwnd -Force:$Force -TimeoutMs 10000)
    }
    if ([Macropad.WindowApi]::Exists($Hwnd)) { throw "The window $Hwnd ('$([Macropad.WindowApi]::Title($Hwnd))') still exists 10 s after it was closed." }
    if ($null -ne $script:E2eRun -and $script:E2eRun.Windows.Remove($Hwnd)) { Write-E2eState }
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

# The environment a macropad under test gets on top of this process's own.
function Get-E2eMacropadEnvironment {
    @{
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
    if ($null -eq $standin) { throw "The stand-in '$Name' did not start within 10 s." }
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

# The lines of a log file that another process may be writing; none when it does not exist yet.
function Read-E2eLog {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return @() }
    $stream = $null
    for ($i = 0; $null -eq $stream; $i++) {
        try { $stream = [System.IO.FileStream]::new($Path, 'Open', 'Read', 'ReadWrite') }
        catch [System.IO.IOException] { if ($i -ge 20) { throw }; [System.Threading.Thread]::Sleep(15) }  # the writer has it open
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

# The stand-in's log lines after Mark, as events: Kind (down, up, char, click, close), Vk, Up.
function Get-E2eStandinEvents {
    param($Standin, [int]$Mark = 0)
    $lines = @(Read-E2eLog $Standin.Log)
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($line -match '^(down|up) vk=([0-9A-F]{2}) sc=([0-9A-F]+) repeat=(\d) mods=(\S+)$') {
            [pscustomobject]@{ Kind = $Matches[1]; Vk = [Convert]::ToInt32($Matches[2], 16); Up = $Matches[1] -eq 'up'; Repeat = $Matches[4] -eq '1'; Mods = $Matches[5]; Line = $line }
        } elseif ($line -match '^char ([0-9A-F]{4})$') {
            [pscustomobject]@{ Kind = 'char'; Vk = 0; Char = [char][Convert]::ToInt32($Matches[1], 16); Up = $false; Repeat = $false; Mods = ''; Line = $line }
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
    # Ready when it answers a key: the first key of the first layer runs E2eMark, which writes a line.
    # Until the macropad takes the key, it reaches the window in front: the stand-in B, a window of the
    # harness, which must be in front for every tap.
    $marks = Join-Path $script:E2eRun.Dir 'marks.log'
    $before = @(Read-E2eLog $marks).Count
    # B is made active once; should something else take the keyboard, B is taken back only under -Ci
    # (nobody at that desktop): on a developer's desktop the start fails, saying what was in front.
    $b = $script:E2eRun.Standins['B'].Hwnd
    if (-not (Set-E2eActive $b)) { throw "Not pressed: the stand-in B could not be made the active window for the readiness taps; $(Get-E2eForegroundText) was in front." }
    $ready = Wait-E2eCondition {
        if ($p.HasExited) { throw "The $Lang macropad exited at start (exit code $($p.ExitCode)). $((Get-E2eErrorLines) -join ' ')" }
        if ($env:OMB_E2E_CI -eq '1') { [void](Set-E2eActive $b) }
        Assert-E2eFront $b 'the stand-in B (readiness taps)'
        Send-E2eTap $script:E2eFirstKeyVk
        Wait-E2eCondition { @(Read-E2eLog $marks).Count -gt $before } -TimeoutMs 700
    } -TimeoutMs 30000 -EveryMs 10
    if (-not $ready) { throw "The $Lang macropad did not answer its keys within 30 s." }
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

# The macropad's visible windows (its overlay while Fn is held, a form, a message box).
function Get-E2eMacropadWindows {
    param([switch]$Overlay, [switch]$Others)
    $m = $script:E2eRun.Macropad
    if ($null -eq $m) { return , @() }
    $all = @([Macropad.Native]::GetProcessWindows([int[]]@($m.Process.Id)))
    # The overlay is the one without a title; forms and message boxes have one.
    if ($Overlay) { return , @($all | Where-Object { [Macropad.WindowApi]::Title($_) -eq '' }) }
    if ($Others) { return , @($all | Where-Object { [Macropad.WindowApi]::Title($_) -ne '' }) }
    , $all
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
# The layouts. A layout has 11 layers of 11 keys; its first layer starts with the harness's own keys
# (E2eMark, which the start waits for, and E2eExit, which ends the macropad). When the cases need more
# keys than one layout has, they go on in a second layout (a chunk), and the macropad is started again
# with it: adding cases never runs out of keys.

# Where each of Count entries goes: Chunk, Layer and Slot, the first two slots of each chunk being the
# harness's own.
function Get-E2eSlotPlan {
    param([int]$Count, [int]$KeyCount = $script:E2eKeyCount)
    $perChunk = $KeyCount * $KeyCount - 2
    , @(for ($i = 0; $i -lt $Count; $i++) {
            $chunk = [math]::Floor($i / $perChunk) + 1
            $n = ($i % $perChunk) + 2
            [pscustomobject]@{ Chunk = $chunk; Layer = [math]::Floor($n / $KeyCount) + 1; Slot = ($n % $KeyCount) + 1 }
        })
}

function Write-E2eLayout {
    param([object[]]$Cases)
    $plan = Get-E2eSlotPlan $Cases.Count
    $chunks = [math]::Max(1, ($plan | Measure-Object Chunk -Maximum).Maximum)
    for ($i = 0; $i -lt $Cases.Count; $i++) { foreach ($k in 'Chunk', 'Layer', 'Slot') { $Cases[$i].$k = $plan[$i].$k } }
    for ($chunk = 1; $chunk -le $chunks; $chunk++) {
        $mine = @($Cases | Where-Object { $_.Chunk -eq $chunk })
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
            Write-E2eLayoutFile $slots.ToArray() (Join-Path $script:E2eRun.Dir "layout-$lang-$chunk.json")
        }
    }
    $script:E2eRun.Chunks = $chunks
}

function Write-E2eLayoutFile {
    param([object[]]$Slots, [string]$Path)
    $keys = @(for ($i = 0; $i -lt $script:E2eKeyCount; $i++) { @{ key = "F$(13 + $i)"; row = [math]::Floor($i / 4) + 1; col = ($i % 4) + 1 } })
    $layers = @(for ($l = 0; $l * $script:E2eKeyCount -lt $Slots.Count; $l++) {
            $last = [math]::Min($Slots.Count, ($l + 1) * $script:E2eKeyCount) - 1
            @{ title = "Test $($l + 1)"; icon = 'default_commands'; macros = @($Slots[($l * $script:E2eKeyCount)..$last]) }
        })
    $layout = @{ fn = @{ key = 'F24'; row = 4; col = 1 }; keys = $keys; layers = $layers; default = 1 }
    [System.IO.File]::WriteAllText($Path, ($layout | ConvertTo-Json -Depth 8))
}

# ---------------------------------------------------------------------------------------------------
# Running a case.

# The lines a macropad under test wrote about an error: the AutoHotkey one through the test's OnError
# (errors.log), the PowerShell one through Show-MacropadError (its log in the run's TEMP).
function Get-E2eErrorLines {
    @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'errors.log')) + @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'temp\LayeredMacropad.log'))
}

# The window that has the keyboard, described for a message.
function Get-E2eForegroundText {
    $h = [Macropad.WindowApi]::Foreground()
    $i = Get-WindowInfo $h
    "'$($i.Title)' ($($i.Exe), class $($i.Class))"
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
    try { $got = Wait-E2eTaps { Get-E2eStandinTaps $ctx.Standin $ctx.Mark } $want.Count -TimeoutMs 8000 }
    catch { throw "The stand-in's key events are not whole chords ($($_.Exception.Message)): $((@(Read-E2eLog $ctx.Standin.Log) | Select-Object -Skip $ctx.Mark) -join ' / ')" }
    ($got -join ', ') | Should -Be ($want -join ', ') -Because "the stand-in must receive exactly the keys of $($ctx.Case.Command) (in front now: $(Get-E2eForegroundText))"
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
    $got = Wait-E2eTaps { Get-E2eWatchTaps } $want.Count
    ($got -join ', ') | Should -Be ($want -join ', ') -Because "the keys pressed must be exactly those of $($ctx.Case.Command)"
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

# Runs one case against the macropad under test. Returns $null when it ran, or the reason it did not
# (the run lists those at its end). Before the macro key is pressed, the window the case named must
# still be in front; when it is not, nothing is pressed and the case fails. Under -Ci only, a failure
# after the press is tried once more when a window the run did not open had taken the focus; the
# second try checks the front again before it presses.
function Invoke-E2eCase {
    param([Parameter(Mandatory)]$Case, [Parameter(Mandatory)][string]$Lang)
    Assert-E2eTime
    $why = Get-E2eSkipReason $Case $Lang
    if ($why) { $script:E2eRun.NotRun.Add("$Lang $($Case.Name): $why"); return $why }
    if ($Case.Kind -eq 'Watch') { $arrange = $script:E2eWatchArrange; $assert = $script:E2eWatchAssert; $Case.Swallow = $true }
    else { $arrange = $script:E2eChordArrange; $assert = $script:E2eChordAssert }
    if ($Case.Arrange) { $arrange = $Case.Arrange }
    if ($Case.Assert) { $assert = $Case.Assert }
    [void](Use-E2eMacropad $Lang $Case.Chunk)
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $ctx = @{ Case = $Case; Lang = $Lang; Run = $script:E2eRun; Pressed = $false }
        $failure = $null
        $foreign = $null
        # What the clean-up after the case could not do: every step of it runs whatever the one before
        # did, and a step that fails is reported beside the case's own failure, never in its place.
        $problems = [System.Collections.Generic.List[string]]::new()
        try {
            Select-E2eLayer $Case.Layer
            $errorsBefore = @(Get-E2eErrorLines).Count
            [OmbE2e.KeyWatch]::Clear()
            $script:E2eRun.LastActivated = [IntPtr]::Zero
            & $arrange $ctx
            # The key goes into the window the case named: one its Arrange set as Front, or the last
            # one it made active; or, with FrontDesktop, the desktop itself. Never whatever is in front.
            if (-not $ctx.Front) { $ctx.Front = $script:E2eRun.LastActivated }
            [OmbE2e.KeyWatch]::Swallow = [bool]$Case.Swallow
            Invoke-E2eCaseKey $ctx -FrontDesktop:([bool]$ctx.FrontDesktop)
            & $assert $ctx
            $errors = @(Get-E2eErrorLines | Select-Object -Skip $errorsBefore)
            $errors -join "`n" | Should -BeNullOrEmpty -Because 'the macropad must not report an error'
        } catch {
            $failure = $_
            $foreign = Get-E2eForeignForeground $Case
        } finally {
            [OmbE2e.KeyWatch]::Swallow = $false
            $step = { param([scriptblock]$Do) try { & $Do } catch { $problems.Add($_.Exception.Message) } }
            & $step { Clear-E2eHeldKeys }
            & $step { if ($Case.CleanUp) { & $Case.CleanUp $ctx } }
            # A form or message box of the macropad's that the case left open would stand in the way
            # of the next case: it is closed, and the case fails (unless it failed already).
            $left = Get-E2eMacropadWindows -Others  # already a list
            if ($left.Count -gt 0 -and -not $failure) { $problems.Add("the macropad still showed $($left.Count) window(s): $(($left | ForEach-Object { "'$([Macropad.WindowApi]::Title($_))'" }) -join ', ')") }
            foreach ($w in $left) { & $step { Close-E2eWindow $w } }
        }
        # Only under -Ci, where nobody is at the desktop, is a case tried again after another window
        # took the focus; on a developer's desktop the case fails, saying what was in front.
        if ($failure -and $problems.Count -eq 0 -and $attempt -eq 1 -and $env:OMB_E2E_CI -eq '1' -and $ctx.Pressed -and $foreign -and $failure.Exception.Message -notlike 'Not pressed:*') {
            Write-Host "End-to-end: $($Case.Name) failed while $foreign had the focus, a window the test did not open; trying once more. The failure was: $($failure.Exception.Message)"
            continue
        }
        if ($problems.Count -eq 0) {
            if ($failure) { throw $failure }
            return $null
        }
        $text = "The clean-up after $($Case.Name) had problems: $($problems -join '; ')"
        if ($failure) { $text = "$($failure.Exception.Message)`n$text" }
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
# works in it (a program a macropad under test started and that outlived its window) is the run's by
# where it is: it is ended, and the clean-up says which. Of a folder from before Windows last started,
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

# Cleans up every leftover run folder; with Ended, only that folder, the one of the run that calls this
# at its own end.
function Clear-E2eLeftovers {
    param([string]$Ended = '')
    $done = [System.Collections.Generic.List[string]]::new()
    $problems = [System.Collections.Generic.List[string]]::new()
    $script:E2eCleanupBanner = 0
    if ($Ended) { $dirs = @(Get-Item -LiteralPath $Ended -ErrorAction SilentlyContinue) }
    else {
        $temp = [OmbE2e.ProcessInfo]::LongPath([System.IO.Path]::GetTempPath())
        $dirs = @(Get-ChildItem -LiteralPath $temp -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^omb-e2e-\d+(-\d+)?$' })
    }
    try {
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
        $Done.Add("${name}: left by a run from before Windows last started (or its state cannot be read); the processes and windows it names ended with Windows and were not touched")
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
                Stop-Process -Id $Id -Force -ErrorAction Stop
                [void](Wait-E2eCondition { -not (Get-Process -Id $Id -ErrorAction SilentlyContinue) } -TimeoutMs 5000)
                $Done.Add("ended $What $Id")
            }
        }
    }
    foreach ($line in $lines) { if ($line -match '^kill (\d+) (\d+) (.+)$') { & $end $line $Matches[3] ([int]$Matches[1]) ([long]$Matches[2]) } }
    # The programs that run from the run's own folder (its copies of AutoHotkey, the launcher) or work
    # in it (what a macropad under test started and nothing closed) are the run's own: while one lives,
    # the folder cannot be removed.
    $where = { param($p) if ($p.WorkingIn) { "$($p.Name) $($p.ProcessId), which worked in the run's folder ($($p.WorkingIn))" } else { "$($p.Name) $($p.ProcessId), which ran from the run's folder" } }
    foreach ($p in Get-E2eRunProcesses $Dir -OrWorkingIn) {
        $what = & $where $p
        & $try '' "ending $what" { Show-E2eCleanupBanner; Wait-ScreenChange; Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $Done.Add("ended $what") }
    }
    [void](Wait-E2eCondition { @(Get-E2eRunProcesses $Dir -OrWorkingIn).Count -eq 0 } -TimeoutMs 5000)
    foreach ($line in $lines) {
        if ($line -match '^window (\d+) (\d+) (\d+) (.+)$') {
            $h = [IntPtr][long]$Matches[1]; $id = [int]$Matches[2]; $start = [long]$Matches[3]; $class = $Matches[4]
            & $try $line "closing window $h" {
                if ([Macropad.WindowApi]::Exists($h) -and [Macropad.WindowApi]::ProcessId($h) -eq $id -and [Macropad.WindowApi]::ClassName($h) -eq $class -and (& $match $id $start)) {
                    Show-E2eCleanupBanner
                    Close-E2eWindow $h
                    $Done.Add("closed window $h ($class)")
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
    $still = @(Get-E2eRunProcesses $Dir -OrWorkingIn)
    if ($still.Count -gt 0) { $Problems.Add("${name}: still running after it was ended: $(($still | ForEach-Object { & $where $_ }) -join '; ')") }
    if ($keep.Count -gt 0 -or $still.Count -gt 0) {
        [System.IO.File]::WriteAllLines((Join-Path $Dir 'state.txt'), [string[]](@($header) + $keep))
        return
    }
    # The one place that deletes a run's record: nothing it names is left to do.
    try { Remove-Item -LiteralPath $Dir -Recurse -Force -ErrorAction Stop; $Done.Add("removed $Dir") }
    catch { $Problems.Add("removing ${Dir}: $($_.Exception.Message) No process that runs from the folder or works in it can be seen from here (one of another user, an elevated one or a 32-bit one cannot be); the next clean-up tries again.") }
}
