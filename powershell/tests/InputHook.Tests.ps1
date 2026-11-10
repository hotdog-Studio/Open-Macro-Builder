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
Describe 'InputHook hotstrings' {
    BeforeAll {
        function New-StringHook([string]$Spec, [string]$Replacement = 'by the way') {
            $h = [Macropad.InputHook]::new(); $p = ConvertFrom-AhkHotstring $Spec
            $h.AddHotstring(0, $p.Abbrev, $p.Options, $p.Execute, $Replacement, 0); $h
        }
        # Types each character (down then up) and returns the result of the last key down.
        function Invoke-Typing($h, [string]$Text) {
            $last = $null
            foreach ($c in $Text.ToCharArray()) {
                $vk = switch ($c) { ' ' { 0x20 } '.' { 0xBE } default { [int][char]::ToUpper($c) } }
                $last = $h.ProcessKey($vk, $false, $false, [string]$c); [void]$h.ProcessKey($vk, $true, $false, '')
            }
            $last
        }
    }
    AfterEach { if ($h) { $h.Dispose() } }
    It 'replaces after an end char' { $h = New-StringHook '::btw'; $r = Invoke-Typing $h 'btw '; $r.Suppress | Should -BeTrue; $r.Backspaces | Should -Be 3; $r.Text | Should -Be 'by the way ' }
    It 'fires on the last character with *' { $h = New-StringHook ':*:btw'; $r = Invoke-Typing $h 'btw'; $r.Backspaces | Should -Be 2; $r.Text | Should -Be 'by the way' }
    It 'needs a word boundary without ?' { $h = New-StringHook '::btw'; (Invoke-Typing $h 'abtw ').Text | Should -BeNullOrEmpty }
    It 'fires inside a word with ?' { $h = New-StringHook ':?:btw'; (Invoke-Typing $h 'abtw ').Text | Should -Be 'by the way ' }
    It 'conforms case' { $h = New-StringHook '::btw'; (Invoke-Typing $h 'BTW ').Text | Should -Be 'BY THE WAY '; (Invoke-Typing $h 'Btw ').Text | Should -Be 'By the way ' }
    It 'matches case exactly with C' { $h = New-StringHook ':C:btw'; (Invoke-Typing $h 'BTW ').Text | Should -BeNullOrEmpty }
    It 'does not conform with C1' { $h = New-StringHook ':C1:btw'; (Invoke-Typing $h 'BTW ').Text | Should -Be 'by the way ' }
    It 'omits the end char with O' { $h = New-StringHook ':O:btw'; (Invoke-Typing $h 'btw.').Text | Should -Be 'by the way' }
    It 'keeps the abbreviation with B0' { $h = New-StringHook ':B0:btw'; $r = Invoke-Typing $h 'btw '; $r.Backspaces | Should -Be 0; $r.Text | Should -Be 'by the way ' }
    It 'applies Backspace to the buffer' { $h = New-StringHook '::btw'; [void](Invoke-Typing $h 'btx'); [void]$h.ProcessKey(0x08, $false, $false, "`b"); (Invoke-Typing $h 'w ').Text | Should -Be 'by the way ' }
    It 'resets on mouse click' { $h = New-StringHook '::btw'; [void](Invoke-Typing $h 'bt'); [void]$h.ProcessMouse(0x01, $false, $false); (Invoke-Typing $h 'w ').Text | Should -BeNullOrEmpty }
    It 'resets when the foreground window changes' { $h = New-StringHook '::btw'; $h.NoteForeground([IntPtr]1); [void](Invoke-Typing $h 'bt'); $h.NoteForeground([IntPtr]2); (Invoke-Typing $h 'w ').Text | Should -BeNullOrEmpty }
    It 'resets on Ctrl combinations' {
        $h = New-StringHook '::btw'; [void](Invoke-Typing $h 'bt')
        [void]$h.ProcessKey(0xA2, $false, $false, ''); [void]$h.ProcessKey(0x43, $false, $false, ''); [void]$h.ProcessKey(0x43, $true, $false, ''); [void]$h.ProcessKey(0xA2, $true, $false, '')
        (Invoke-Typing $h 'w ').Text | Should -BeNullOrEmpty
    }
    It 'does not match on its own replacement' {
        $h = New-StringHook '::btw'; [void]$h.ProcessKey(0x42, $false, $true, 'b'); [void]$h.ProcessKey(0x54, $false, $true, 't')
        (Invoke-Typing $h 'w ').Text | Should -BeNullOrEmpty
    }
    It 'fires execute hotstrings' { $h = New-StringHook ':X:go'; $r = Invoke-Typing $h 'go '; $r.Fired | Should -Be @(0); $r.Backspaces | Should -Be 2; $r.Text | Should -Be ' ' }
}
Describe 'InputHook resync and delivery' {
    AfterEach { if ($h) { $h.Dispose() } }
    It 'forgets a modifier whose release it never saw (Win+L, Ctrl+Alt+Del)' {
        $h = New-Hook '#x'; [void](Dn $h 0x5B); $h.ResyncModifiers([int[]]@(), 0)
        $r = Dn $h 0x58; $r.Fired.Count | Should -Be 0; $r.Suppress | Should -BeFalse
    }
    It 'keeps a modifier the system still reports down' {
        $h = New-Hook '#x'; [void](Dn $h 0x5B); $h.ResyncModifiers([int[]]@(0x5B), 0)
        (Dn $h 0x58).Fired | Should -Be @(0)
    }
    It 'injects a hotstring''s keys before running its macro' {
        $h = [Macropad.InputHook]::new(); $script:log = [System.Collections.ArrayList]::new()
        $h.Sender = [Action[Macropad.KeyInput[]]] { param($k) [void]$script:log.Add('inject') }
        $h.FirePoster = [Action[int]] { param($id) [void]$script:log.Add("fire:$id") }
        $r = [Macropad.HookResult]::new(); $r.Fired = [int[]]@(4); $r.Backspaces = 2; $r.Text = ' '
        $h.Deliver($r); $h.DrainPending()
        $script:log -join ',' | Should -Be 'inject,fire:4'
    }
    It 'posts a hotkey with nothing to inject at once' {
        $h = [Macropad.InputHook]::new(); $script:log = [System.Collections.ArrayList]::new()
        $h.FirePoster = [Action[int]] { param($id) [void]$script:log.Add("fire:$id") }
        $r = [Macropad.HookResult]::new(); $r.Fired = [int[]]@(1)
        $h.Deliver($r)
        $script:log -join ',' | Should -Be 'fire:1'
    }
}
