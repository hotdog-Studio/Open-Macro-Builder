BeforeDiscovery {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    # The example config.json, plus your own local\config.json when you have one.
    $configs = @('config.json') + @('local\config.json' | Where-Object { Test-Path -LiteralPath (Join-Path $root $_) })
}
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    $root = Split-Path $ps -Parent
    foreach ($f in 'Native','Interop','Pump','Assets','Input','Model','Overlay','Window','Engine','AhkSyntax','WinTitle','Hotkeys','ConfigJson') { . "$ps\lib\$f.ps1" }
    Get-MacropadCommandFiles | ForEach-Object { . $_ }
    . "$ps\config.ps1"
    . "$PSScriptRoot\helpers\ConfigDump.ps1"
}
Describe 'choosing the config file' {
    BeforeEach {
        $saved = $env:OMB_CONFIG; $env:OMB_CONFIG = $null
        $dir = Join-Path $env:TEMP "omb-root-$PID"; New-Item -ItemType Directory -Force "$dir\local" | Out-Null
    }
    AfterEach { $env:OMB_CONFIG = $saved; Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
    It 'loads the example config.json when there is no local one' { Get-MacropadConfigPath $dir | Should -Be (Join-Path $dir 'config.json') }
    It 'prefers local\config.json' { Set-Content "$dir\local\config.json" '{}'; Get-MacropadConfigPath $dir | Should -Be (Join-Path $dir 'local\config.json') }
    It 'prefers OMB_CONFIG over both' { Set-Content "$dir\local\config.json" '{}'; $env:OMB_CONFIG = 'C:\x\my.json'; Get-MacropadConfigPath $dir | Should -Be 'C:\x\my.json' }
}
Describe 'the example config.json' {
    BeforeAll { $layout = Import-MacropadConfig (Join-Path $root 'config.json') }
    It 'has the example layout in AHK order' {
        $titles = @($layout.Layers | ForEach-Object { if ($null -eq $_) { '' } else { $_.Title } })
        $titles -join ',' | Should -Be 'Media,Programs,Chrome,,VS Code,VS Code Debug,VS Studio,Examples,,Windows,Window Management,'
        $layout.Layers[7].Macros[2].Action | Should -Be 'SshExample'; $layout.Layers[1].Macros[0].Name | Should -Be 'Explorer'
    }
    It 'uses the keypad keys and options' {
        $layout.Keys.Count | Should -Be 12; $layout.Fn.Name | Should -Be 'ScrollLock'; $layout.Fn.W | Should -Be 128
        $layout.DefaultIndex | Should -Be 0; $layout.ShowFn | Should -Be ' '; $layout.ShowMacroMarkers | Should -BeTrue; $layout.ShowLabels | Should -BeTrue
    }
}
Describe 'config <_>' -ForEach $configs {
    BeforeAll { $path = Join-Path $root $_; $layout = Import-MacropadConfig $path }
    It 'references only defined command functions' {
        { Test-LayoutActions $layout } | Should -Not -Throw
        { Test-HotkeyActions @(Import-MacropadHotkeys $path) } | Should -Not -Throw
    }
    It 'references only images that exist' {
        for ($s = 0; $s -lt $layout.Layers.Count; $s++) {
            if ($null -eq $layout.Layers[$s]) { continue }
            for ($i = 0; $i -lt $layout.Keys.Count; $i++) { { Get-CachedImage (Get-ButtonState $layout $s $i).Image } | Should -Not -Throw }
        }
    }
    It 'reads the same way in ahk/config.ahk' -Tag Integration {
        . "$PSScriptRoot\helpers\Ahk.ps1"
        $saved = $env:OMB_CONFIG; $env:OMB_CONFIG = $path
        try { $r = Invoke-AhkScript "$root\ahk\dump_config.ahk" } finally { $env:OMB_CONFIG = $saved }
        if ($null -eq $r) { Set-ItResult -Skipped -Because 'AutoHotkey v2 is not installed'; return }
        $r.ExitCode | Should -Be 0 -Because $r.Err
        ($r.Out -replace "`r`n", "`n").TrimEnd("`n") | Should -BeExactly (Get-MacropadConfigDump $layout @(Import-MacropadHotkeys $path))
    }
}
