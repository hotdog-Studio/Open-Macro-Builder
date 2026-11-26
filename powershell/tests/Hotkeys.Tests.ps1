BeforeAll {
    foreach ($f in 'Native', 'Interop', 'Pump', 'Assets', 'Input', 'Model', 'Engine', 'AhkSyntax', 'WinTitle', 'Hotkeys') { . "$PSScriptRoot\..\lib\$f.ps1" }
    function Act { param($m) $script:ran = $m.Name }
    $layout = Layout (Key 'ScrollLock' 2 1 2 1) @((Key 'F13' 1 1), (Key 'F14' 1 2)) @((Layer 'A' (Icon 'chrome')))
    # A form shown and put in front the way the macropad puts a window in front (Native.ActivateWindow
    # attaches to the foreground thread). Form.Activate is not enough: Windows refuses it to a program
    # that does not hold the foreground, and on the build agent the foreground is held by the agent's
    # own console.
    function Show-FormInFront {
        $f = New-Object System.Windows.Forms.Form; $f.Show(); Wait-Pump 100
        [void][Macropad.Native]::ActivateWindow($f.Handle); Wait-Pump 200
        $f
    }
    # Empty when the form is the foreground window. Otherwise the reason a test that needs it in front
    # skips itself, in words a build log explains by itself.
    function Get-NotInFrontReason($Form) {
        $fg = Get-ForegroundInfo
        if ($null -ne $fg -and $fg.Hwnd -eq $Form.Handle) { return '' }
        $holder = if ($null -eq $fg) { 'no window' } elseif ($fg.Exe) { $fg.Exe } else { "a window of process $($fg.Pid)" }
        "$holder kept the foreground, so the test form could not be brought in front of it. Windows lets another program keep the foreground; on the build agent it is the Jenkins agent's own console, a Windows Terminal window"
    }
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
Describe 'Hotstring' {
    It 'keeps replacement text' { $d = Hotstring ':*:btw' 'by the way'; $d.Parsed.Abbrev | Should -Be 'btw'; $d.Replacement | Should -Be 'by the way'; $d.Macro | Should -BeNullOrEmpty }
    It 'wraps execute actions in a macro' { $d = Hotstring ':X:go' 'Act'; $d.Macro.Action | Should -Be 'Act'; $d.Replacement | Should -BeNullOrEmpty }
    It 'checks execute actions exist' { { Test-HotkeyActions @((Hotstring ':X:go' 'NoSuchFn')) } | Should -Throw 'Undefined hotkey action(s): NoSuchFn (:X:go)' }
}
# Both tests need their form in the foreground, which Show-FormInFront asks for as the macropad does.
# Windows still lets another program keep it (the Jenkins agent's console, or someone typing elsewhere
# during the run), and then the test skips itself and says which program kept it.
Describe 'ForegroundWatcher title hook' -Tag Integration {
    It 'listens for title changes only in the foreground window''s process' {
        $w = [Macropad.ForegroundWatcher]::new()
        $f = Show-FormInFront
        try {
            $why = Get-NotInFrontReason $f
            if ($why) { Set-ItResult -Skipped -Because $why; return }
            $w.NameHookProcessId | Should -Be $PID
        } finally { $f.Dispose(); $w.Dispose() }
    }
    It 'raises Changed when the foreground window''s title changes' {
        $f = Show-FormInFront
        $w = [Macropad.ForegroundWatcher]::new(); $w.Context = @{ Count = 0 }
        $w.add_Changed({ param($sender, $e) $sender.Context.Count++ })
        try {
            $why = Get-NotInFrontReason $f
            if ($why) { Set-ItResult -Skipped -Because $why; return }
            $f.Text = 'renamed'; Wait-Pump 200
            $w.Context.Count | Should -BeGreaterThan 0
        } finally { $f.Dispose(); $w.Dispose() }
    }
}
