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
        function Send-NumLock([bool]$Up) {
            $flags = [Macropad.Native]::KEYEVENTF_EXTENDEDKEY; if ($Up) { $flags = $flags -bor [Macropad.Native]::KEYEVENTF_KEYUP }
            [Macropad.Native]::keybd_event(0x90, [byte][Macropad.Native]::MapVirtualKey(0x90, 0), $flags, [UIntPtr]::Zero)
        }
    }
    It 'reads the new state of NumLock while a window of another process has the focus' {
        # As when a command runs: the macropad's thread has a window and pumps its messages with Wait-Pump,
        # but the focus is on another program. NumLock is pressed once, and again in finally, within a second.
        $focus = [Macropad.WindowApi]::Foreground()
        $focus | Should -Not -Be ([IntPtr]::Zero) -Because 'a window must have the focus'
        [Macropad.WindowApi]::ProcessId($focus) | Should -Not -Be $PID -Because 'the focus must be on a window of another process'
        $before = Get-NumLocked
        $window = [Macropad.HotkeyWindow]::new()
        $pressed = $false; $seen = $before
        $sw = [System.Diagnostics.Stopwatch]::new()
        try {
            Wait-Pump 50
            Test-KeyToggled 'NumLock' | Should -Be $before -Because 'it agrees with a new process before the press'
            $sw.Start()
            Send-NumLock $false; Send-NumLock $true; $pressed = $true
            while ($sw.ElapsedMilliseconds -lt 500) {
                Wait-Pump 20
                $seen = Test-KeyToggled 'NumLock'
                if ($seen -ne $before) { break }
            }
        } finally {
            if ($pressed) { Send-NumLock $false; Send-NumLock $true }
            $sw.Stop()
            $window.Dispose()
        }
        $seen | Should -Be (-not $before) -Because "NumLock was switched $(('on', 'off')[[int]$before]) $($sw.ElapsedMilliseconds) ms before it was put back"
        $sw.ElapsedMilliseconds | Should -BeLessThan 1000 -Because 'NumLock stays changed for under a second'
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
