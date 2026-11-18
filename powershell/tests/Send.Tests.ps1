BeforeAll {
    $lib = "$PSScriptRoot\..\lib"
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'Send') { . "$lib\$f.ps1" }
    function Fmt($Inputs) { ($Inputs | ForEach-Object { $(if ($_.Char) { [string][char]$_.Char } else { '{0:X2}' -f $_.Vk }) + ('v', '^')[[int]$_.Up] }) -join ' ' }
}
Describe 'Interop' {
    It 'compiles every lib/cs file into one assembly' { [Macropad.Interop].Assembly | Should -Be ([Macropad.Inject].Assembly) }
    It 'uses the MPAD signature' { [Macropad.Interop]::Signature | Should -Be 0x4D504144 }
    It 'sizes INPUT like Win32' { [Macropad.Inject]::InputSize | Should -Be $(if ([Environment]::Is64BitProcess) { 40 } else { 28 }) }
    It 'shares the signature with Native.ps1' { Get-Content "$lib\Native.ps1" -Raw | Should -Match 'MacropadSignature = 0x4D504144' }
    It 'can be dot-sourced twice' { { . "$lib\Interop.ps1" } | Should -Not -Throw }
}
Describe 'ConvertTo-KeyInput' {
    It 'marks extended keys and carries characters' {
        $k = ConvertTo-KeyInput (ConvertFrom-AhkSend ('{Left}' + [char]0xE9)).Events
        $k.Count | Should -Be 4
        $k[0].Vk | Should -Be 0x25; $k[0].Extended | Should -BeTrue
        $k[2].Char | Should -Be 0xE9; $k[2].Vk | Should -Be 0
    }
    It 'gives each key the scan code it has on the keyboard layout of the active window' {
        Mock Get-ForegroundKeyboardLayout { [IntPtr]0x111 }
        Mock Get-LayoutScanCode { 0x29 } -ParameterFilter { $Vk -eq 0xDF -and $Layout -eq [IntPtr]0x111 }
        Mock Get-LayoutScanCode { 0 } -ParameterFilter { -not ($Vk -eq 0xDF -and $Layout -eq [IntPtr]0x111) }
        $k = ConvertTo-KeyInput @([pscustomobject]@{ Vk = 0xDF; Char = 0; Up = $false }, [pscustomobject]@{ Vk = 0; Char = 0x41; Up = $false })
        $k[0].Scan | Should -Be 0x29
        $k[1].Scan | Should -Be 0 -Because 'a character is sent as Unicode, with no key'
    }
}
Describe 'Send-Ahk' {
    BeforeEach { $script:sent = $null; Mock Send-KeyInput { $script:sent = $Inputs } }
    It 'releases held modifiers behind a menu mask' { Mock Get-HeldModifier { @(0xA4) }; Send-Ahk 'x'; Fmt $script:sent | Should -Be 'E8v E8^ A4^ xv x^' }
    It 'releases Ctrl without a mask' { Mock Get-HeldModifier { @(0xA2) }; Send-Ahk 'x'; Fmt $script:sent | Should -Be 'A2^ xv x^' }
    It 'leaves modifiers alone with Blind' { Mock Get-HeldModifier { @(0xA2) }; Send-Ahk '{Blind}x'; Fmt $script:sent | Should -Be 'xv x^' }
}
Describe 'Wait-Key' {
    It 'returns true once the key is released' { Mock Test-VirtualKeyDown { $false }; Wait-Key 'a' | Should -BeTrue }
    It 'times out while the key stays down' { Mock Test-VirtualKeyDown { $true }; Wait-Key 'a' -TimeoutMs 50 | Should -BeFalse }
    It 'waits for a press with -Down' { Mock Test-VirtualKeyDown { $true }; Wait-Key 'a' -Down -TimeoutMs 50 | Should -BeTrue }
}
Describe 'Test-KeyToggled with real key events' -Tag Integration {
    BeforeAll {
        # The NumLock state as a process started now reads it, apart from this test's own thread.
        function Get-NumLocked { [bool]::Parse((powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Control]::IsKeyLocked('NumLock')")) }
        # Another process presses NumLock, as a keyboard or another program would. It says 'ready'; when
        # the event <name>-press is set it presses and says 'pressed'; when <name>-restore is set, or this
        # test's process is gone, it presses again and says 'restored <ms from press to restore>'. Its own
        # 5 s timer is only the last resort. Without a press event, or with this process gone, it ends
        # without pressing, at the latest after 20 s.
        $script:PresserScript = @"
`$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace NumLockTest -Name Key -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra); [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);'
function Send-NumLock { `$scan = [byte][NumLockTest.Key]::MapVirtualKey(0x90, 0); [NumLockTest.Key]::keybd_event(0x90, `$scan, 1, [UIntPtr]::Zero); [NumLockTest.Key]::keybd_event(0x90, `$scan, 3, [UIntPtr]::Zero) }
`$test = [Diagnostics.Process]::GetProcessById(PARENT)
`$press = [Threading.EventWaitHandle]::OpenExisting('NAME-press'); `$restore = [Threading.EventWaitHandle]::OpenExisting('NAME-restore')
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
`$sw = [Diagnostics.Stopwatch]::StartNew()
while (-not `$press.WaitOne(100)) { if (`$test.HasExited -or `$sw.ElapsedMilliseconds -gt 20000) { exit } }
`$sw.Restart(); Send-NumLock
[Console]::Out.WriteLine('pressed'); [Console]::Out.Flush()
while (-not `$restore.WaitOne(20)) { if (`$test.HasExited -or `$sw.ElapsedMilliseconds -gt 5000) { break } }
Send-NumLock; [Console]::Out.WriteLine("restored `$(`$sw.ElapsedMilliseconds)"); [Console]::Out.Flush()
"@
        function Start-NumLockPresser([string]$Name) {
            $psi = New-Object System.Diagnostics.ProcessStartInfo 'powershell'
            $code = $script:PresserScript.Replace('NAME', $Name).Replace('PARENT', [string]$PID)
            $psi.Arguments = '-NoProfile -NonInteractive -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
            $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
            $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
            [System.Diagnostics.Process]::Start($psi)
        }
        # The next line the presser writes, or an error when none comes within the limit.
        function Read-PresserLine($Presser, [int]$TimeoutMs) {
            $line = $Presser.StandardOutput.ReadLineAsync()
            if (-not $line.Wait($TimeoutMs)) { throw "The NumLock presser said nothing within $TimeoutMs ms." }
            $line.Result
        }
        # A press from this process, only to put NumLock back when the presser could not.
        function Send-NumLockHere {
            foreach ($flags in [Macropad.Native]::KEYEVENTF_EXTENDEDKEY, ([Macropad.Native]::KEYEVENTF_EXTENDEDKEY -bor [Macropad.Native]::KEYEVENTF_KEYUP)) {
                [Macropad.Native]::keybd_event(0x90, [byte][Macropad.Native]::MapVirtualKey(0x90, 0), $flags, [UIntPtr]::Zero)
            }
        }
    }
    It 'reads the new state of NumLock in a hotkey handler while a window of another process has the focus' {
        # As when a command runs: the macropad's thread has a window and runs the command inside its
        # message loop, in the handler of a WM_HOTKEY; the focus is on another program; and the key is
        # pressed by another process. NumLock is changed only for the reads, and put back also on failure.
        $focus = [Macropad.WindowApi]::Foreground()
        $focus | Should -Not -Be ([IntPtr]::Zero) -Because 'a window must have the focus'
        [Macropad.WindowApi]::ProcessId($focus) | Should -Not -Be $PID -Because 'the focus must be on a window of another process'
        $before = Get-NumLocked
        $window = $null; $press = $null; $restore = $null; $presser = $null; $restored = ''; $putBackHere = $false
        $reads = [System.Collections.ArrayList]::new()
        try {
            $window = [Macropad.HotkeyWindow]::new()
            $window.Context = @{ Reads = $reads; Clock = [System.Diagnostics.Stopwatch]::StartNew() }
            $window.add_HotkeyPressed({ param($sender, $e)
                    [void]$sender.Context.Reads.Add([pscustomobject]@{ Id = $e.Id; Ms = $sender.Context.Clock.ElapsedMilliseconds; On = (Test-KeyToggled 'NumLock') }) })
            $name = "Local\MacropadNumLockTest$PID"
            $press = [System.Threading.EventWaitHandle]::new($false, 'ManualReset', "$name-press")
            $restore = [System.Threading.EventWaitHandle]::new($false, 'ManualReset', "$name-restore")
            $presser = Start-NumLockPresser $name
            Read-PresserLine $presser 30000 | Should -Be 'ready'
            [void][Macropad.WindowApi]::Post($window.Handle, 0x312, [IntPtr]1, [IntPtr]::Zero)
            Wait-Pump 30
            [void]$press.Set()
            Read-PresserLine $presser 3000 | Should -Be 'pressed'
            $window.Context.Clock.Restart()
            # The first read is in the first handler after the press, with no pump of its own before it.
            foreach ($k in 2..11) { [void][Macropad.WindowApi]::Post($window.Handle, 0x312, [IntPtr]$k, [IntPtr]::Zero); Wait-Pump 20 }
        } finally {
            if ($restore) { [void]$restore.Set() }
            if ($presser) {
                if ($presser.WaitForExit(3000)) { $restored = $presser.StandardOutput.ReadToEnd().Trim() }
                else { $presser.Kill() }
            }
            foreach ($d in $window, $press, $restore) { if ($d) { $d.Dispose() } }
            if ((Get-NumLocked) -ne $before) { Send-NumLockHere; $putBackHere = $true }
        }
        $reads = @($reads)
        Write-Host ('NumLock was {0}; reads in the hotkey handler: {1}; presser: {2}' -f $(if ($before) { 'on' } else { 'off' }),
            (($reads | ForEach-Object { "#$($_.Id) at $($_.Ms) ms: $(if ($_.On) { 'on' } else { 'off' })" }) -join ', '), $restored)
        $putBackHere | Should -BeFalse -Because 'the presser puts NumLock back itself'
        ($reads | Where-Object Id -eq 1).On | Should -Be $before -Because 'before the press it agrees with a new process'
        $after = @($reads | Where-Object Id -gt 1)
        $after.Count | Should -BeGreaterThan 0
        $after[0].On | Should -Be (-not $before) -Because 'the first handler after the press reads the new state'
        @($after | Where-Object { $_.On -eq $before }).Count | Should -Be 0 -Because 'no read before the restore goes back to the old state'
        $restored | Should -Match '^restored \d+$'
        [int]($restored -replace '\D', '') | Should -BeLessThan 1000 -Because 'NumLock stays changed for under a second'
        Get-NumLocked | Should -Be $before -Because 'NumLock is put back'
    }
}
Describe 'Set-LockKeyState' {
    It 'taps only when the state differs' {
        Mock Send-KeyInput {}
        Mock Test-KeyToggled { $false }; Set-LockKeyState CapsLock $true; Should -Invoke Send-KeyInput -Times 1 -Exactly
        Mock Test-KeyToggled { $true }; Set-LockKeyState CapsLock $true; Should -Invoke Send-KeyInput -Times 1 -Exactly
    }
}
