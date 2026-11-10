BeforeAll {
    foreach ($f in 'Native', 'Interop', 'Input', 'AhkSyntax') { . "$PSScriptRoot\..\lib\$f.ps1" }
    function New-Hook([string[]]$Specs) {
        $h = [Macropad.InputHook]::new()
        for ($i = 0; $i -lt $Specs.Count; $i++) {
            $p = ConvertFrom-AhkHotkey $Specs[$i]
            $h.AddHotkey($i, $p.Vk, $p.Mods, [int]$p.Wildcard + 2 * [int]$p.Passthrough + 4 * [int]$p.KeyUp, $p.PrefixVk, 0)
        }
        $h
    }
    function Dn($h, [int]$Vk, [switch]$Self) { $h.ProcessKey($Vk, $false, [bool]$Self, '') }
    function Up($h, [int]$Vk) { $h.ProcessKey($Vk, $true, $false, '') }
}
Describe 'InputHook hotkeys' {
    AfterEach { if ($h) { $h.Dispose() } }
    It 'fires ^!t only with exactly Ctrl and Alt held' {
        $h = New-Hook '^!t'; [void](Dn $h 0xA2); [void](Dn $h 0xA4)
        $r = Dn $h 0x54; $r.Fired | Should -Be @(0); $r.Suppress | Should -BeTrue
        [void](Up $h 0x54); [void](Dn $h 0xA0); (Dn $h 0x54).Fired.Count | Should -Be 0
    }
    It 'ignores extra modifiers with *' { $h = New-Hook '*^t'; [void](Dn $h 0xA3); [void](Dn $h 0xA0); (Dn $h 0x54).Fired | Should -Be @(0) }
    It 'respects the side of a modifier' {
        $h = New-Hook '>^a'; [void](Dn $h 0xA2); (Dn $h 0x41).Fired.Count | Should -Be 0
        [void](Up $h 0x41); [void](Up $h 0xA2); [void](Dn $h 0xA3); (Dn $h 0x41).Fired | Should -Be @(0)
    }
    It 'does not suppress with ~' { $h = New-Hook '~^t'; [void](Dn $h 0xA2); $r = Dn $h 0x54; $r.Fired | Should -Be @(0); $r.Suppress | Should -BeFalse }
    It 'suppresses the release of a suppressed key' { $h = New-Hook '^t'; [void](Dn $h 0xA2); [void](Dn $h 0x54); $r = Up $h 0x54; $r.Suppress | Should -BeTrue; $r.Fired.Count | Should -Be 0 }
    It 'fires up hotkeys on release' { $h = New-Hook 'a up'; $d = Dn $h 0x41; $d.Suppress | Should -BeTrue; $d.Fired.Count | Should -Be 0; (Up $h 0x41).Fired | Should -Be @(0) }
    It 'ignores events carrying the signature' { $h = New-Hook '^t'; [void](Dn $h 0xA2); $r = Dn $h 0x54 -Self; $r.Fired.Count | Should -Be 0; $r.Suppress | Should -BeFalse }
    It 'masks the menu after a suppressed Win hotkey' { $h = New-Hook '#x'; [void](Dn $h 0x5B); (Dn $h 0x58).MaskMenu | Should -BeTrue }
    It 'does not mask the menu for Ctrl hotkeys' { $h = New-Hook '^x'; [void](Dn $h 0xA2); (Dn $h 0x58).MaskMenu | Should -BeFalse }
    It 'passes keys with no hotkey' { $h = New-Hook '^t'; $r = Dn $h 0x41; $r.Suppress | Should -BeFalse; $r.Fired.Count | Should -Be 0 }
    It 'fires a custom combination and swallows the prefix' {
        $h = New-Hook 'a & b'
        (Dn $h 0x41).Suppress | Should -BeTrue
        $r = Dn $h 0x42; $r.Fired | Should -Be @(0); $r.Suppress | Should -BeTrue
        (Up $h 0x42).Suppress | Should -BeTrue
        $u = Up $h 0x41; $u.Suppress | Should -BeTrue; $u.ReinjectVk | Should -Be 0
    }
    It 're-sends an unused prefix on release' { $h = New-Hook 'a & b'; [void](Dn $h 0x41); (Up $h 0x41).ReinjectVk | Should -Be 0x41 }
    It 'fires a mouse wheel hotkey' { $h = New-Hook '^WheelUp'; [void](Dn $h 0xA2); $r = $h.ProcessMouse(0x9F, $false, $false); $r.Fired | Should -Be @(0); $r.Suppress | Should -BeTrue }
}
Describe 'InputHook contexts' {
    AfterEach { if ($h) { $h.Dispose() } }
    It 'prefers an active context variant over the global one' {
        $h = [Macropad.InputHook]::new(); $p = ConvertFrom-AhkHotkey '^t'
        $h.AddHotkey(0, $p.Vk, $p.Mods, 0, 0, 0); $h.AddHotkey(1, $p.Vk, $p.Mods, 0, 0, 1)
        [void](Dn $h 0xA2); (Dn $h 0x54).Fired | Should -Be @(0); [void](Up $h 0x54)
        $h.SetContextActive(1, $true); (Dn $h 0x54).Fired | Should -Be @(1)
    }
    It 'passes the key when its only variant is inactive' {
        $h = [Macropad.InputHook]::new(); $p = ConvertFrom-AhkHotkey '^t'; $h.AddHotkey(0, $p.Vk, $p.Mods, 0, 0, 1)
        [void](Dn $h 0xA2); $r = Dn $h 0x54; $r.Suppress | Should -BeFalse; $r.Fired.Count | Should -Be 0
    }
}
