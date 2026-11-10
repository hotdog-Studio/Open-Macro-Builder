BeforeAll {
    foreach ($f in 'Native', 'Interop', 'Pump', 'Assets', 'Input', 'Model', 'Engine', 'AhkSyntax', 'WinTitle', 'Hotkeys') { . "$PSScriptRoot\..\lib\$f.ps1" }
    function Act { param($m) $script:ran = $m.Name }
    $layout = Layout (Key 'ScrollLock' 2 1 2 1) @((Key 'F13' 1 1), (Key 'F14' 1 2)) @((Layer 'A' (Icon 'chrome')))
}
Describe 'Hotkey' {
    It 'parses the spec and wraps the action' { $d = Hotkey '^!t' 'Act'; $d.Parsed.Vk | Should -Be 0x54; $d.Macro.Action | Should -Be 'Act'; $d.Macro.Name | Should -Be '^!t' }
}
Describe 'Test-HotkeyActions' {
    It 'lists undefined actions' { { Test-HotkeyActions @((Hotkey '^t' 'NoSuchFn'), (Hotkey '^y' 'Act')) } | Should -Throw 'Undefined hotkey action(s): NoSuchFn (^t)' }
}
Describe 'New-InputHook' {
    BeforeEach {
        $script:ran = $null
        $engine = New-Engine $layout -GetSelected { 0 } -SelectLayer { param($i) $true } -RunMacro { param($m) Invoke-Macro $m } -ShowOverlay {} -HideOverlay {} -OnError { param($m, $e) }
    }
    It 'rejects hotkeys on macropad keys' {
        { New-InputHook @((Hotkey 'F13' 'Act')) $engine $layout -NoStart } | Should -Throw "Hotkey 'F13' uses macropad key 'F13'."
        { New-InputHook @((Hotkey '+ScrollLock' 'Act')) $engine $layout -NoStart } | Should -Throw "Hotkey '+ScrollLock' uses macropad key 'ScrollLock'."
    }
    It 'runs a fired hotkey through the engine guard' {
        $h = New-InputHook @((Hotkey '^t' 'Act')) $engine $layout -NoStart
        try {
            $h.PostFired(0); Wait-Pump 50; $ran | Should -Be '^t'
            $script:ran = $null; $engine.Busy = $true; $h.PostFired(0); Wait-Pump 50; $ran | Should -BeNullOrEmpty
        } finally { Remove-InputHook $h }
    }
}
Describe 'hotkey contexts' {
    BeforeAll {
        $defs = @((Hotkey '^t' 'Act' -IfWinActive 'ahk_exe code.exe'), (Hotkey '^y' 'Act' -IfWinActive 'ahk_exe code.exe'), (Hotkey '^u' 'Act' -IfWinNotActive 'ahk_exe code.exe'))
        $vsCode = [pscustomobject]@{ Hwnd = [IntPtr]5; Title = 'x.ps1 - Visual Studio Code'; Class = 'Chrome_WidgetWin_1'; Pid = 9; Exe = 'Code.exe'; Path = 'C:\x\Code.exe'; Visible = $true }
    }
    It 'numbers distinct contexts in first-seen order' {
        $c = Get-HotkeyContexts $defs
        $c.Count | Should -Be 2; $c[0].Id | Should -Be 1; $c[0].Negate | Should -BeFalse; $c[1].Id | Should -Be 2; $c[1].Negate | Should -BeTrue
    }
    It 'activates contexts from the foreground window' {
        $hook = [pscustomobject]@{ Set = @{} }; $hook | Add-Member ScriptMethod SetContextActive { param($id, $on) $this.Set[$id] = $on }
        $c = Get-HotkeyContexts $defs
        Update-HotkeyContexts $hook $c $vsCode; $hook.Set[1] | Should -BeTrue; $hook.Set[2] | Should -BeFalse
        Update-HotkeyContexts $hook $c $null; $hook.Set[1] | Should -BeFalse; $hook.Set[2] | Should -BeTrue
    }
    It 'rejects both context kinds on one hotkey' { { Hotkey '^t' 'Act' -IfWinActive 'a' -IfWinNotActive 'b' } | Should -Throw 'Use either IfWinActive or IfWinNotActive, not both.' }
}
Describe 'ForegroundWatcher' -Tag Integration {
    It 'raises Changed when another window comes to the front' {
        $w = [Macropad.ForegroundWatcher]::new(); $w.Context = @{ Count = 0 }
        $w.add_Changed({ param($sender, $e) $sender.Context.Count++ })
        $f = New-Object System.Windows.Forms.Form; $f.Show(); $f.Activate(); Wait-Pump 200
        try { $w.Context.Count | Should -BeGreaterThan 0 } finally { $f.Dispose(); $w.Dispose() }
    }
}
