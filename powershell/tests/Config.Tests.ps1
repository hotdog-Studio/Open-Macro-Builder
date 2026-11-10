BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    $root = Split-Path $ps -Parent
    foreach ($f in 'Native','Interop','Pump','Assets','Input','Model','Overlay','Window','Engine','AhkSyntax','WinTitle','Hotkeys','ConfigJson') { . "$ps\lib\$f.ps1" }
    Get-ChildItem "$ps\commands" -Recurse -Filter *.ps1 | ForEach-Object { . $_.FullName }
    . "$ps\config.ps1"
    . "$PSScriptRoot\helpers\ConfigDump.ps1"
    $layout = Get-MacropadConfig
}
Describe 'the shared config.json' {
    It 'is the file config.ps1 loads' { Get-MacropadConfigPath | Should -Be (Join-Path $root 'config.json') }
    It 'has the full layout in AHK order' {
        $titles = @($layout.Layers | ForEach-Object { if ($null -eq $_) { '' } else { $_.Title } })
        $titles -join ',' | Should -Be 'Programs,Chrome,Server,,VS Code,VS Code Debug,Godot,VS Studio,,Windows,Window Management,'
        $layout.Layers[0].Macros[0].Action | Should -Be 'OpenYoutube'; $layout.Layers[10].Macros[11].Name | Should -Be 'Task View'
    }
    It 'uses the same keys and options' {
        $layout.Keys.Count | Should -Be 12; $layout.Fn.Name | Should -Be 'ScrollLock'; $layout.Fn.W | Should -Be 128
        $layout.DefaultIndex | Should -Be 10; $layout.ShowFn | Should -Be ' '; $layout.ShowMacroMarkers | Should -BeTrue; $layout.ShowLabels | Should -BeTrue
    }
    It 'references only defined command functions' { { Test-LayoutActions $layout } | Should -Not -Throw; { Test-HotkeyActions @(Get-MacropadHotkeys) } | Should -Not -Throw }
    It 'references only images that exist' {
        for ($s = 0; $s -lt $layout.Layers.Count; $s++) {
            if ($null -eq $layout.Layers[$s]) { continue }
            for ($i = 0; $i -lt $layout.Keys.Count; $i++) { { Get-CachedImage (Get-ButtonState $layout $s $i).Image } | Should -Not -Throw }
        }
    }
}
Describe 'config parity with the AutoHotkey loader' -Tag Integration {
    It 'reads config.json the same way in ahk/config.ahk' {
        . "$PSScriptRoot\helpers\Ahk.ps1"
        $r = Invoke-AhkScript "$root\ahk\dump_config.ahk"
        if ($null -eq $r) { Set-ItResult -Skipped -Because 'AutoHotkey v2 is not installed'; return }
        $r.ExitCode | Should -Be 0 -Because $r.Err
        ($r.Out -replace "`r`n", "`n").TrimEnd("`n") | Should -BeExactly (Get-MacropadConfigDump $layout @(Get-MacropadHotkeys))
    }
}
