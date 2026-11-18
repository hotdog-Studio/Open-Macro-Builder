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

$script:E2eRepo = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$script:E2eFixtures = Join-Path $script:E2eRepo 'ahk\tests\e2e'
$script:E2eFloorMs = 350
$script:E2eChangeClock = $null
$script:E2eWarning = 'Photosensitivity warning: this test opens, moves and closes windows. Look away if flashing affects you.'
# Fn is F24 and the macro keys are F13 to F23 in the test's layout: keys no keyboard in the room has.
$script:E2eFnVk = 0x87
$script:E2eFirstKeyVk = 0x7C
$script:E2eKeyCount = 11

# ---------------------------------------------------------------------------------------------------
# Pacing: at most three changes of the screen a second.

<#
.SYNOPSIS
Keeps the screen from changing more than about three times a second during the end-to-end test.
.DESCRIPTION
Call it right before anything that shows, hides, moves, sizes, maximizes, minimizes or restores a
window, or shows or hides the macropad's overlay, including a key press that makes a command do so.
It waits until at least FloorMs have passed since the previous change, then counts the coming change
as now. With -Observed it waits for nothing and only records that a change has just been seen to
happen (a window that appeared some time after the key), so the next change keeps its distance from
that one. It is a floor on how fast the screen may change, never how a case decides pass or fail.
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
# Waiting for a condition, within the case's own limit and the run's.

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

# Taps one key: down, a moment, up.
function Send-E2eTap {
    param([Parameter(Mandatory)][int]$Vk, [int]$HoldMs = 40)
    Send-E2eKey $Vk
    Wait-Pump $HoldMs
    Send-E2eKey $Vk -Up
}

# Presses the keys of a chord such as 'Ctrl+Shift+t' (the library's names) from this process.
function Send-E2eChord {
    param([Parameter(Mandatory)][string]$Chord)
    foreach ($e in (ConvertTo-KeyEvent $Chord)) { Send-E2eKey $e.Vk -Up:([bool]$e.Up); Wait-Pump 15 }
}

function Send-E2eClick {
    param([int]$X, [int]$Y, [ValidateSet('Left', 'Right')][string]$Button = 'Left')
    [void][OmbE2e.Input]::MoveMouse($X, $Y)
    Wait-Pump 30
    $flags = @{ Left = @(2, 4); Right = @(8, 16) }[$Button]
    [void][OmbE2e.Input]::Mouse($flags[0]); Wait-Pump 30; [void][OmbE2e.Input]::Mouse($flags[1])
}

# ---------------------------------------------------------------------------------------------------
# Processes the run started, the watchdog's state file, and the banner.

function Write-E2eState {
    $lines = @(foreach ($p in $script:E2eRun.Processes) { "kill $($p.Pid) $($p.Name)" })
    $lines += "killdir $($script:E2eRun.Dir)"
    if ($null -ne $script:E2eRun.Owner) { $lines += "run $($script:E2eRun.Owner.Restart)" }
    [System.IO.File]::WriteAllLines($script:E2eRun.StateFile, [string[]]$lines)
}

# Starts a program for the run and remembers it, so that it is ended at the end of the run (or by the
# banner's watchdog if this process goes away first). Environment entries are added to this process's
# own, minus OMB_E2E and OMB_E2E_CASE; this process's own environment is never changed.
function Start-E2eProcess {
    param([Parameter(Mandatory)][string]$File, [string]$Arguments = '', [hashtable]$Environment = @{}, [switch]$NoTrack)
    $si = [System.Diagnostics.ProcessStartInfo]::new($File, $Arguments)
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    foreach ($k in 'OMB_E2E', 'OMB_E2E_CASE') { [void]$si.EnvironmentVariables.Remove($k) }
    foreach ($k in $Environment.Keys) { $si.EnvironmentVariables[$k] = [string]$Environment[$k] }
    $p = [System.Diagnostics.Process]::Start($si)
    if (-not $NoTrack) {
        $script:E2eRun.Processes.Add([pscustomobject]@{ Pid = $p.Id; Name = [System.IO.Path]::GetFileName($File) })
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

function Get-E2eUnixTime { [long]([DateTime]::UtcNow - [DateTime]'1970-01-01').TotalSeconds }

function Start-E2eBanner {
    Wait-ScreenChange
    $deadline = [long]($script:E2eRun.Deadline - [DateTime]'1970-01-01').TotalSeconds
    $arguments = '"{0}" {1} "{2}" {3}' -f (Join-Path $script:E2eFixtures 'banner.ahk'), $PID, $script:E2eRun.StateFile, $deadline
    $p = Start-E2eProcess (Get-AhkExe) $arguments -NoTrack
    $script:E2eRun.BannerPid = $p.Id
    $window = Wait-E2eCondition { $w = Find-Window "Open Macro Builder end-to-end test ahk_pid $($p.Id)"; if ($w -ne [IntPtr]::Zero) { $w } } -TimeoutMs 10000
    if ($null -eq $window) { throw 'The banner did not appear within 10 s.' }
    Wait-ScreenChange -Observed
}

function Stop-E2eBanner {
    if (-not $script:E2eRun.BannerPid) { return }
    Wait-ScreenChange
    Stop-Process -Id $script:E2eRun.BannerPid -Force -ErrorAction SilentlyContinue
    $script:E2eRun.BannerPid = $null
}

# ---------------------------------------------------------------------------------------------------
# The macropad that was running before the run (the owner's), found the way the configurator finds it
# (configurator/electron/macropad.ts): only the macropad's own script in this checkout counts.

function ConvertTo-E2eComparable {
    param([string]$Text)
    $Text.Replace('"', '').Replace('/', '\').Trim().ToLowerInvariant().TrimEnd('\')
}

# Which of the processes runs this checkout's macropad: a row with Lang, Pid, Exe, CommandLine, or
# $null. $Processes are Win32_Process rows (Name, ProcessId, ExecutablePath, CommandLine).
function Find-E2eMacropad {
    param([object[]]$Processes, [string]$Root, [int[]]$Ignore = @())
    $base = ConvertTo-E2eComparable $Root
    $ahkLine = '(^|\s)' + [regex]::Escape("$base\ahk\main.ahk") + '$'
    $psLine = '(^|\s)-file\s+' + [regex]::Escape("$base\powershell\main.ps1") + '(\s|$)'
    foreach ($p in @($Processes)) {
        if (-not $p.CommandLine -or $Ignore -contains [int]$p.ProcessId) { continue }
        $line = ConvertTo-E2eComparable $p.CommandLine
        $m = [regex]::Match($line, $ahkLine)
        if ($p.Name -like 'autohotkey*' -and $p.ExecutablePath -and $m.Success) {
            if ($line.Substring(0, $m.Index) -match '(^|\s)\\validate(\s|$)') { continue }
            return [pscustomobject]@{ Lang = 'ahk'; Pid = [int]$p.ProcessId; Exe = $p.ExecutablePath; CommandLine = $p.CommandLine }
        }
    }
    foreach ($p in @($Processes)) {
        if (-not $p.CommandLine -or $Ignore -contains [int]$p.ProcessId) { continue }
        if ($p.Name -eq 'powershell.exe' -and (ConvertTo-E2eComparable $p.CommandLine) -match $psLine) {
            return [pscustomobject]@{ Lang = 'ps'; Pid = [int]$p.ProcessId; Exe = $p.ExecutablePath; CommandLine = $p.CommandLine }
        }
    }
    $null
}

function Get-E2eMacropadProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name LIKE 'AutoHotkey%' OR Name = 'powershell.exe'" | Select-Object Name, ProcessId, ExecutablePath, CommandLine)
}

# What starts it again: the AutoHotkey exe with main.ahk, or wscript with launch.vbs, as the
# configurator's relaunchCommand does.
function Get-E2eRestartLine {
    param($Found)
    if ($Found.Lang -eq 'ahk') { return '"{0}" "{1}"' -f $Found.Exe, (Join-Path $script:E2eRepo 'ahk\main.ahk') }
    'wscript.exe "{0}"' -f (Join-Path $script:E2eRepo 'powershell\launch.vbs')
}

# Stops the macropad that runs from this checkout, if any, and remembers how to start it again.
function Stop-E2eOwnerMacropad {
    $found = Find-E2eMacropad (Get-E2eMacropadProcesses) $script:E2eRepo
    if ($null -eq $found) { return }
    $found | Add-Member Restart (Get-E2eRestartLine $found)
    $script:E2eRun.Owner = $found
    Write-E2eState
    Write-Host "End-to-end: stopping the running $($found.Lang) macropad (pid $($found.Pid)); it is started again at the end with: $($found.Restart)"
    if ($found.Lang -eq 'ahk') {
        $main = Find-Window "ahk_class AutoHotkey ahk_pid $($found.Pid)" -IncludeHidden
        if ($main -ne [IntPtr]::Zero) { [void][Macropad.WindowApi]::Post($main, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
    } else {
        Stop-Process -Id $found.Pid -Force -ErrorAction SilentlyContinue
    }
    $gone = Wait-E2eCondition { -not (Get-Process -Id $found.Pid -ErrorAction SilentlyContinue) } -TimeoutMs 5000
    if (-not $gone) { Stop-Process -Id $found.Pid -Force -ErrorAction SilentlyContinue }
}

# Starts the owner's macropad again, the way it was started, and waits until it runs.
function Restore-E2eOwnerMacropad {
    $owner = $script:E2eRun.Owner
    if ($null -eq $owner) { return }
    if ($owner.Lang -eq 'ahk') { $file = $owner.Exe; $arguments = '"{0}"' -f (Join-Path $script:E2eRepo 'ahk\main.ahk') }
    else { $file = 'wscript.exe'; $arguments = '"{0}"' -f (Join-Path $script:E2eRepo 'powershell\launch.vbs') }
    [void](Start-E2eProcess $file $arguments -NoTrack)
    $script:E2eRun.Owner = $null
    Write-E2eState
    $back = Wait-E2eCondition { Find-E2eMacropad (Get-E2eMacropadProcesses) $script:E2eRepo } -TimeoutMs 20000
    if ($null -eq $back) { throw "The $($owner.Lang) macropad that was running before the test did not start again. Start it by hand: $($owner.Restart)" }
    Write-Host "End-to-end: the $($owner.Lang) macropad runs again (pid $($back.Pid))."
}

# ---------------------------------------------------------------------------------------------------
# The run: its folder, the program stand-ins, and its end.

function New-E2eRun {
    param([int]$LimitMinutes = 15)
    $dir = Join-Path ([System.IO.Path]::GetTempPath()) "omb-e2e-$PID"
    if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
    foreach ($sub in 'bin', 'path', 'temp', 'E2E Test') { [void](New-Item -ItemType Directory -Path (Join-Path $dir $sub)) }
    $script:E2eRun = [pscustomobject]@{
        Dir          = $dir
        LimitMinutes = $LimitMinutes
        Deadline     = [DateTime]::UtcNow.AddMinutes($LimitMinutes)
        StateFile    = Join-Path $dir 'state.txt'
        Processes    = [System.Collections.Generic.List[object]]::new()
        Owner        = $null
        BannerPid    = $null
        Standins     = @{}
        Macropad     = $null
        Windows      = [System.Collections.Generic.List[IntPtr]]::new()
        DesktopCount = $null
    }
    Write-E2eState
    $script:E2eRun
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
# the macropad finds first on its PATH, with an AutoHotkey copy of the same name for its window.
function Install-E2eLaunchers {
    param([string[]]$Names = @('chrome.exe', 'putty.exe', 'ssh.exe', 'e2eapp.exe'))
    $built = Join-Path $script:E2eRun.Dir 'launcher.exe'
    Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $script:E2eFixtures 'launcher.cs') -Raw) -OutputAssembly $built -OutputType WindowsApplication
    foreach ($n in $Names) {
        Copy-Item -LiteralPath $built -Destination (Join-Path $script:E2eRun.Dir "path\$n")
        [void](Get-E2eAhkCopy $n)
    }
    # A program whose path has spaces, for the helpers' quoting.
    Copy-Item -LiteralPath $built -Destination (Join-Path $script:E2eRun.Dir 'E2E Test\e2e app.exe')
    [void](Get-E2eAhkCopy 'e2e app.exe')
}

# The scripts the script helpers run, in a folder with a space in its name, and the folders and files
# the cases open.
function Install-E2eScripts {
    $dir = Join-Path $script:E2eRun.Dir 'E2E Test'
    foreach ($f in 'write.py', 'write.ps1', 'args.bat') { Copy-Item -LiteralPath (Join-Path $script:E2eFixtures $f) -Destination $dir }
    [void](New-Item -ItemType Directory -Path (Join-Path $dir 'Smith, John'))
    Set-Content -LiteralPath (Join-Path $dir 'note a.txt') -Value 'end-to-end test'
}

# The programs the launcher recorded after Mark: Exe (its full path), Log (its stand-in's log) and
# Arguments (what followed the program on its command line).
function Get-E2eLaunches {
    param([int]$Mark = 0)
    $lines = @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'launches.log'))
    for ($i = $Mark; $i -lt $lines.Count; $i++) {
        $p = $lines[$i] -split "`t", 3
        $line = $p[2]
        # The program as the command line names it, quoted or not, then the rest.
        if ($line.StartsWith('"')) { $rest = $line.Substring($line.IndexOf('"', 1) + 1) } else { $rest = ($line -replace '^\S+', '') }
        [pscustomobject]@{ Exe = $p[0]; Log = $p[1]; Arguments = $rest.Trim() }
    }
}

function Get-E2eLaunchMark { @(Read-E2eLog (Join-Path $script:E2eRun.Dir 'launches.log')).Count }

# The processes running from the run's folder (stand-ins the launcher started, copies of AutoHotkey).
function Get-E2eRunProcesses {
    $dir = $script:E2eRun.Dir.TrimEnd('\') + '\'
    @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) })
}

# Ends the stand-ins the launcher started (not A, B and C), with a paced change.
function Stop-E2eLaunched {
    $keep = @($script:E2eRun.Processes | ForEach-Object { $_.Pid })
    foreach ($p in Get-E2eRunProcesses) {
        if ($keep -contains [int]$p.ProcessId) { continue }
        Wait-ScreenChange
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------------------------------
# Windows that commands open.

# The windows on the screen that fit any of the WinTitles (Find-Window's form), as a list of handles.
function Get-E2eWindows {
    param([string[]]$WinTitle, [switch]$IncludeCloaked)
    $seen = [System.Collections.Generic.List[IntPtr]]::new()
    # A cloaked window (another virtual desktop, a Store app's frame that is starting or closing) counts as
    # visible to Windows but is not on the screen; it is left out.
    foreach ($t in $WinTitle) { foreach ($h in (Find-Window $t -All)) { if (-not $seen.Contains($h) -and ($IncludeCloaked -or -not [OmbE2e.Dwm]::Cloaked($h))) { $seen.Add($h) } } }
    , $seen.ToArray()
}

# The visible windows of the WinTitles that the run did not open (a person's own), as descriptions.
function Get-E2eForeignWindows {
    param([string[]]$WinTitle)
    $ours = @($script:E2eRun.Processes | ForEach-Object { $_.Pid }) + @(Get-E2eRunProcesses | ForEach-Object { [int]$_.ProcessId })
    # A person's window counts even while Windows cloaks it (a suspended Store app, another desktop).
    , @(foreach ($h in (Get-E2eWindows $WinTitle -IncludeCloaked)) {
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

# Waits for a window that fits a WinTitle and is not in Before; with -Active, until it is also the
# active window. Its handle, or $null. A found window is remembered, so that the run closes it at the
# end if the case does not.
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
        if ($script:E2eRun.Windows -notcontains $h) { $script:E2eRun.Windows.Add([IntPtr]$h) }
    }
    $h
}

# Closes a window a command opened (paced), and ends its program if it stays.
function Close-E2eWindow {
    param([IntPtr]$Hwnd, [switch]$Force)
    if (-not [Macropad.WindowApi]::Exists($Hwnd)) { return }
    Wait-ScreenChange
    [void](Close-Window $Hwnd -Force:$Force -TimeoutMs 4000)
    [void]$script:E2eRun.Windows.Remove($Hwnd)
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
        // a suspended app's frame) although IsWindowVisible says it is visible.
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

# How many virtual desktops there are (Explorer keeps their ids, 16 bytes each).
function Get-E2eDesktopCount {
    $ids = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops' -Name VirtualDesktopIDs -ErrorAction SilentlyContinue).VirtualDesktopIDs
    if ($null -eq $ids) { return 1 }
    [math]::Max(1, $ids.Length / 16)
}

# Closes virtual desktops a failed case left, until there are as many as the run found: from the
# desktop where the stand-in A is, it goes right and closes that one (Win+Ctrl+Right, Win+Ctrl+F4).
function Restore-E2eDesktops {
    if ($null -eq $script:E2eRun.DesktopCount) { return }
    $a = $script:E2eRun.Standins['A']
    for ($i = 0; $i -lt 5 -and (Get-E2eDesktopCount) -gt $script:E2eRun.DesktopCount; $i++) {
        if ($null -ne $a -and [OmbE2e.Desktops]::OnCurrent($a.Hwnd)) { Wait-ScreenChange; Send-E2eChord 'LWin+Ctrl+Right'; Wait-Pump 400 }
        Wait-ScreenChange
        Send-E2eChord 'LWin+Ctrl+F4'
        [void](Wait-E2eCondition { (Get-E2eDesktopCount) -le $script:E2eRun.DesktopCount -or ($null -ne $a -and [OmbE2e.Desktops]::OnCurrent($a.Hwnd)) } -TimeoutMs 3000)
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
    $stream = [System.IO.FileStream]::new($Path, 'Open', 'Read', 'ReadWrite')
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

# The stand-in's log lines after Mark, as events: Kind (down, up, click, close), Vk, Up.
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
# counting as none yet; then waits SettleMs more, so that a key that comes after shows too.
function Wait-E2eTaps {
    param([scriptblock]$Read, [int]$Count, [int]$TimeoutMs = 4000, [int]$SettleMs = 300)
    $got = Wait-E2eCondition { try { $t = & $Read; if ($t.Count -ge $Count) { , $t } } catch { $null } } -TimeoutMs $TimeoutMs
    Wait-Pump $SettleMs
    $got
}

# The taps a list of chords makes, such as @('Ctrl+e', 't'), or 'text:...' entries kept as they are:
# what a command should press, worked out on the keyboard layout of the active window.
function ConvertTo-E2eExpectedTap {
    param([string[]]$Chords)
    , @(foreach ($c in $Chords) {
            if ($c.StartsWith('text:')) { $c } else { foreach ($t in (ConvertTo-E2eTap @(ConvertTo-KeyEvent $c | ForEach-Object { [pscustomobject]@{ Kind = 'key'; Vk = $_.Vk; Up = $_.Up; Repeat = $false } }))) { $t } }
        })
}

# Makes a window the active one; true when it is.
function Set-E2eActive {
    param([IntPtr]$Hwnd)
    $ok = Wait-E2eCondition { if ([Macropad.Native]::ActivateWindow($Hwnd)) { $true } } -TimeoutMs 3000 -EveryMs 100
    [bool]$ok
}

# ---------------------------------------------------------------------------------------------------
# The macropad under test.

function Start-E2eMacropad {
    param([Parameter(Mandatory)][ValidateSet('ahk', 'ps')][string]$Lang)
    $envs = Get-E2eMacropadEnvironment
    $envs.OMB_CONFIG = Join-Path $script:E2eRun.Dir "layout-$Lang.json"
    if ($Lang -eq 'ahk') {
        $arguments = '/ErrorStdOut=UTF-8 /include "{0}" "{1}"' -f (Join-Path $script:E2eFixtures 'commands.ahk'), (Join-Path $script:E2eRepo 'ahk\main.ahk')
        $p = Start-E2eProcess (Get-AhkExe) $arguments -Environment $envs
    } else {
        # As launch.vbs starts it, with the test's own commands loaded first.
        $command = ". '{0}'; . '{1}'" -f (Join-Path $script:E2eFixtures 'commands.ps1'), (Join-Path $script:E2eRepo 'powershell\main.ps1')
        $p = Start-E2eProcess 'powershell.exe' ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "{0}"' -f $command) -Environment $envs
    }
    $script:E2eRun.Macropad = [pscustomobject]@{ Lang = $Lang; Process = $p; Layer = 1 }
    # Ready when it answers a key: the first key of the first layer runs E2eMark, which writes a line.
    $marks = Join-Path $script:E2eRun.Dir 'marks.log'
    $before = @(Read-E2eLog $marks).Count
    $ready = Wait-E2eCondition {
        if ($p.HasExited) { throw "The $Lang macropad exited at start (exit code $($p.ExitCode)). $((Get-E2eErrorLines) -join ' ')" }
        Send-E2eTap $script:E2eFirstKeyVk
        Wait-E2eCondition { @(Read-E2eLog $marks).Count -gt $before } -TimeoutMs 700
    } -TimeoutMs 30000 -EveryMs 10
    if (-not $ready) { throw "The $Lang macropad did not answer its keys within 30 s." }
    $script:E2eRun.Macropad
}

# Ends the macropad under test through its own exit command (E2eExit, the second key of the first
# layer), and by force when it is still there after 5 s.
function Stop-E2eMacropad {
    $m = $script:E2eRun.Macropad
    if ($null -eq $m) { return }
    if (-not $m.Process.HasExited) {
        try {
            Select-E2eLayer 1
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
    $all = @([Macropad.Native]::GetProcessWindows([int[]]@($m.Process.Id)))
    # The overlay is the one without a title; forms and message boxes have one.
    if ($Overlay) { return , @($all | Where-Object { [Macropad.WindowApi]::Title($_) -eq '' }) }
    if ($Others) { return , @($all | Where-Object { [Macropad.WindowApi]::Title($_) -ne '' }) }
    , $all
}

# Selects a layer as a person does: hold Fn, press the layer's key, let Fn go. The overlay shows and
# hides, so both are paced.
function Select-E2eLayer {
    param([Parameter(Mandatory)][int]$Index)
    $m = $script:E2eRun.Macropad
    if ($m.Layer -eq $Index) { return }
    Wait-ScreenChange
    Send-E2eKey $script:E2eFnVk
    $shown = Wait-E2eCondition { (Get-E2eMacropadWindows -Overlay).Count -gt 0 } -TimeoutMs 3000
    Send-E2eTap ($script:E2eFirstKeyVk + $Index - 1)
    Wait-ScreenChange
    Send-E2eKey $script:E2eFnVk -Up
    if (-not $shown) { throw "The overlay did not show while Fn was held (layer $Index)." }
    $hidden = Wait-E2eCondition { (Get-E2eMacropadWindows -Overlay).Count -eq 0 } -TimeoutMs 3000
    if (-not $hidden) { throw "The overlay did not hide when Fn was let go (layer $Index)." }
    Wait-ScreenChange -Observed
    $m.Layer = $Index
}

# Presses the macro key of a slot (1 to 11) on the current layer.
function Invoke-E2eMacroKey {
    param([Parameter(Mandatory)][int]$Slot)
    Send-E2eTap ($script:E2eFirstKeyVk + $Slot - 1)
}

# ---------------------------------------------------------------------------------------------------
# The layout: the first layer holds the harness's own keys (E2eMark, which the start waits for, and
# E2eExit, which ends the macropad); the cases follow in order, eleven to a layer.

function Write-E2eLayout {
    param([object[]]$Cases)
    $slots = [System.Collections.Generic.List[object]]::new()
    $slots.Add(@{ action = 'E2eMark'; name = 'ready' })
    $slots.Add(@{ action = 'E2eExit'; name = 'exit' })
    foreach ($case in $Cases) {
        $case.Layer = [math]::Floor($slots.Count / $script:E2eKeyCount) + 1
        $case.Slot = ($slots.Count % $script:E2eKeyCount) + 1
        $entry = @{ action = $case.Command; name = $case.Command; description = ''; only = $case.Only }
        if ($case.Macro) { foreach ($k in $case.Macro.Keys) { $entry[$k] = $case.Macro[$k] } }
        $slots.Add($entry)
    }
    # One layout file per language: a case for one language only leaves its key empty in the other's.
    foreach ($lang in 'ahk', 'ps') {
        $mine = @(foreach ($s in $slots) {
                if ($s.only -and $s.only -ne $lang) { $null; continue }
                $copy = @{}; foreach ($k in $s.Keys) { if ($k -ne 'only') { $copy[$k] = $s[$k] } }; $copy
            })
        Write-E2eLayoutFile $mine (Join-Path $script:E2eRun.Dir "layout-$lang.json")
    }
}

function Write-E2eLayoutFile {
    param([object[]]$Slots, [string]$Path)
    $keys = @(for ($i = 0; $i -lt $script:E2eKeyCount; $i++) { @{ key = "F$(13 + $i)"; row = [math]::Floor($i / 4) + 1; col = ($i % 4) + 1 } })
    $slots = $Slots
    $layers = @(for ($l = 0; $l * $script:E2eKeyCount -lt $slots.Count; $l++) {
            $last = [math]::Min($slots.Count, ($l + 1) * $script:E2eKeyCount) - 1
            @{ title = "Test $($l + 1)"; icon = 'default_commands'; macros = @($slots[($l * $script:E2eKeyCount)..$last]) }
        })
    if ($layers.Count -gt $script:E2eKeyCount) { throw "The cases need $($layers.Count) layers; the layout has room for $($script:E2eKeyCount)." }
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
    [void](Wait-E2eTaps { Get-E2eStandinTaps $ctx.Standin $ctx.Mark } $want.Count -TimeoutMs 8000)
    $got = Get-E2eStandinTaps $ctx.Standin $ctx.Mark
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
    [void](Wait-E2eTaps { Get-E2eWatchTaps } $want.Count)
    $got = Get-E2eWatchTaps
    ($got -join ', ') | Should -Be ($want -join ', ') -Because "the keys pressed must be exactly those of $($ctx.Case.Command)"
}

# Runs one case against the macropad under test. Returns $null when it ran, or the reason it was
# skipped. A failure is tried once more when a window the run did not open had the focus, since a
# person or another program then took the keys.
function Invoke-E2eCase {
    param([Parameter(Mandatory)]$Case, [Parameter(Mandatory)][string]$Lang)
    Assert-E2eTime
    if ($Case.Only -and $Case.Only -ne $Lang) { return "runs against the $($Case.Only) macropad only: $($Case.Why)" }
    if ($Case.SkipIf) { $why = & $Case.SkipIf; if ($why) { return $why } }
    if ($Case.Kind -eq 'Watch') { $arrange = $script:E2eWatchArrange; $assert = $script:E2eWatchAssert; $Case.Swallow = $true }
    else { $arrange = $script:E2eChordArrange; $assert = $script:E2eChordAssert }
    if ($Case.Arrange) { $arrange = $Case.Arrange }
    if ($Case.Assert) { $assert = $Case.Assert }
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        $ctx = @{ Case = $Case; Lang = $Lang; Run = $script:E2eRun }
        $caught = $false
        try {
            Select-E2eLayer $Case.Layer
            $errorsBefore = @(Get-E2eErrorLines).Count
            [OmbE2e.KeyWatch]::Clear()
            & $arrange $ctx
            [OmbE2e.KeyWatch]::Swallow = [bool]$Case.Swallow
            Wait-ScreenChange
            Invoke-E2eMacroKey $Case.Slot
            & $assert $ctx
            $errors = @(Get-E2eErrorLines | Select-Object -Skip $errorsBefore)
            $errors -join "`n" | Should -BeNullOrEmpty -Because 'the macropad must not report an error'
            return $null
        } catch {
            $caught = $true
            $foreign = Get-E2eForeignForeground $Case
            if ($attempt -eq 1 -and $foreign) {
                Write-Host "End-to-end: $($Case.Command) failed while $foreign had the focus, a window the test did not open; trying once more. The failure was: $($_.Exception.Message)"
                continue
            }
            throw
        } finally {
            [OmbE2e.KeyWatch]::Swallow = $false
            if ($Case.CleanUp) { & $Case.CleanUp $ctx }
            # A form or message box of the macropad's that the case left open would stand in the way
            # of the next case: it is closed, and the case fails (unless it failed already).
            $left = Get-E2eMacropadWindows -Others  # already a list
            foreach ($w in $left) { Close-E2eWindow $w }
            if ($left.Count -gt 0 -and -not $caught) { throw "The macropad still showed $($left.Count) window(s) after $($Case.Command): $(($left | ForEach-Object { "'$([Macropad.WindowApi]::Title($_))'" }) -join ', ')" }
        }
    }
}

# ---------------------------------------------------------------------------------------------------
# The end of the run, also after a failure: everything the run started ends, the owner's macropad
# starts again, the folder goes.

function Complete-E2eRun {
    if ($null -eq $script:E2eRun) { return }
    $problems = [System.Collections.Generic.List[string]]::new()
    [OmbE2e.KeyWatch]::Stop()
    try { Stop-E2eMacropad } catch { $problems.Add("stopping the macropad: $($_.Exception.Message)") }
    try { Restore-E2eDesktops } catch { $problems.Add("closing the virtual desktops the test made: $($_.Exception.Message)") }
    foreach ($h in @($script:E2eRun.Windows)) {
        try { Close-E2eWindow $h } catch { $problems.Add("closing window $h`: $($_.Exception.Message)") }
    }
    foreach ($p in @($script:E2eRun.Processes)) {
        try { Wait-ScreenChange; Stop-E2eProcessId $p.Pid } catch { $problems.Add("ending $($p.Name) ($($p.Pid)): $($_.Exception.Message)") }
    }
    foreach ($p in Get-E2eRunProcesses) {
        try { Wait-ScreenChange; Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { $problems.Add("ending $($p.Name) ($($p.ProcessId)): $($_.Exception.Message)") }
    }
    [void](Wait-E2eCondition { (Get-E2eRunProcesses).Count -eq 0 } -TimeoutMs 5000)
    try { Restore-E2eOwnerMacropad } catch { $problems.Add($_.Exception.Message) }
    try { Stop-E2eBanner } catch { $problems.Add("closing the banner: $($_.Exception.Message)") }
    try { Remove-Item -LiteralPath $script:E2eRun.Dir -Recurse -Force -ErrorAction Stop } catch { $problems.Add("removing $($script:E2eRun.Dir): $($_.Exception.Message)") }
    $script:E2eRun = $null
    if ($problems.Count -gt 0) { throw ("The end-to-end clean-up had problems: " + ($problems -join '; ')) }
}
