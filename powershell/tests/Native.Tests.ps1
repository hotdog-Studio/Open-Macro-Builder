BeforeAll { . "$PSScriptRoot\..\lib\Native.ps1" }
Describe 'Macropad.Native' {
    It 'loads the static class with the Win32 entry points' {
        foreach ($m in 'RegisterHotKey','UnregisterHotKey','GetAsyncKeyState','keybd_event','MapVirtualKey','GetProcessWindows','ActivateWindow','SetSuspendState','GetConsoleWindow') {
            [Macropad.Native].GetMethod($m) | Should -Not -BeNullOrEmpty -Because "$m must exist"
        }
    }
    It 'exposes MOD_NOREPEAT' { [Macropad.Native]::MOD_NOREPEAT | Should -Be 0x4000 }
    It 'returns an array for GetProcessWindows even with no matches' {
        $r = [Macropad.Native]::GetProcessWindows([int[]]@(0))
        ,$r | Should -BeOfType [System.Array]
        $r.Count | Should -Be 0
    }
    It 'can be dot-sourced twice without error' { { . "$PSScriptRoot\..\lib\Native.ps1" } | Should -Not -Throw }
}
Describe 'Macropad.HotkeyWindow' {
    It 'creates a handle and registers/unregisters a hotkey' {
        $w = [Macropad.HotkeyWindow]::new()
        $w.Handle | Should -Not -Be ([IntPtr]::Zero)
        $w.Context = @{ x = 1 }; $w.Context.x | Should -Be 1
        $w.Register(7, 0x1 -bor 0x2 -bor 0x4 -bor 0x4000, 0x87) | Should -BeTrue   # Alt+Ctrl+Shift+F24
        $w.Unregister(7) | Should -BeTrue
        $w.Dispose()
    }
}
Describe 'Macropad.HotkeyWindow Fn hook' {
    It 'exposes HookFnKey and the FnDown/FnUp events' {
        [Macropad.HotkeyWindow].GetMethod('HookFnKey') | Should -Not -BeNullOrEmpty
        [Macropad.HotkeyWindow].GetEvent('FnDown') | Should -Not -BeNullOrEmpty
        [Macropad.HotkeyWindow].GetEvent('FnUp') | Should -Not -BeNullOrEmpty
    }
    It 'installs the hook and removes it on Dispose' {
        $w = [Macropad.HotkeyWindow]::new()
        $w.HookFnKey(0x91) | Should -BeTrue
        { $w.Dispose() } | Should -Not -Throw
    }
}
Describe 'Fn hook with real key events' -Tag Integration {
    BeforeAll {
        function Get-ScrollLocked { [bool]::Parse((powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Control]::IsKeyLocked('Scroll')")) }
        function Send-ScrollLock([bool]$Up) {
            $flags = 0; if ($Up) { $flags = [Macropad.Native]::KEYEVENTF_KEYUP }
            [Macropad.Native]::keybd_event(0x91, [byte][Macropad.Native]::MapVirtualKey(0x91, 0), $flags, [UIntPtr]::Zero)
        }
    }
    It 'swallows Fn, raises FnDown and FnUp once each and leaves the lock state alone' {
        $before = Get-ScrollLocked
        $w = [Macropad.HotkeyWindow]::new()
        $w.Context = @{ Events = [System.Collections.ArrayList]::new() }
        $w.add_FnDown({ param($sender, $e) [void]$sender.Context.Events.Add('down') })
        $w.add_FnUp({ param($sender, $e) [void]$sender.Context.Events.Add('up') })
        try {
            $w.HookFnKey(0x91) | Should -BeTrue
            Send-ScrollLock $false; Send-ScrollLock $false; Send-ScrollLock $false   # autorepeat
            Send-ScrollLock $true
            $deadline = [DateTime]::Now.AddSeconds(2)
            while ($w.Context.Events.Count -lt 2 -and [DateTime]::Now -lt $deadline) {
                [System.Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 10
            }
        } finally { $w.Dispose() }
        $w.Context.Events -join ',' | Should -Be 'down,up'
        Get-ScrollLocked | Should -Be $before
    }
}
Describe 'Macropad.HotkeyEventArgs' {
    It 'carries the id' { [Macropad.HotkeyEventArgs]::new(5).Id | Should -Be 5 }
}
Describe 'Macropad.OverlayForm' {
    It 'is a Form' { [Macropad.OverlayForm]::new() | Should -BeOfType [System.Windows.Forms.Form] }
}
Describe 'Macropad.KeyHook decisions' {
    It 'posts one down per press, ignoring auto-repeat, and an up on release' {
        $k = [Macropad.KeyHook]::new([IntPtr]::Zero, 0x91)
        $k.Decide($false, 1000) | Should -Be 1; $k.Decide($false, 1030) | Should -Be 0; $k.Decide($true, 1100) | Should -Be 2
    }
    It 'treats a down long after the last one as a new press when the release was missed' {
        $k = [Macropad.KeyHook]::new([IntPtr]::Zero, 0x91)
        $k.Decide($false, 1000) | Should -Be 1; $k.Decide($false, 9000) | Should -Be 1
    }
}
