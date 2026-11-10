BeforeAll {
    foreach ($f in 'Native', 'Interop', 'Pump', 'Assets', 'Input', 'Model', 'Engine', 'AhkSyntax', 'Hotkeys') { . "$PSScriptRoot\..\lib\$f.ps1" }
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
