BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native','Interop','Pump','Assets','Input','Model','Overlay','Window','Engine') { . "$ps\lib\$f.ps1" }
    Get-ChildItem "$ps\commands" -Recurse -Filter *.ps1 | ForEach-Object { . $_.FullName }
    . "$ps\config.ps1"
    $layout = Get-MacropadConfig
    # Parse ahk/config.ahk into @{ Title; Icon; Macros = @(@{Action;Name}|$null) } entries ($null for blank layers)
    function Get-AhkConfig {
        $layers = [System.Collections.ArrayList]::new(); $current = $null; $inLayers = $false
        foreach ($line in Get-Content (Join-Path (Split-Path $ps -Parent) 'ahk\config.ahk')) {
            $t = $line.Trim()
            if ($t -match '^;') { continue }
            if ($t -match '^\], \[$') { $inLayers = $true; continue }
            if (-not $inLayers) { continue }
            if ($t -match '^Layer\("([^"]*)", Icon\("([^"]*)"\), \[$') { $current = @{ Title = $Matches[1]; Icon = $Matches[2]; Macros = [System.Collections.ArrayList]::new() }; continue }
            if ($t -match '^Macro\((\w+), "([^"]*)"') { [void]$current.Macros.Add(@{ Action = $Matches[1]; Name = $Matches[2] }); continue }
            if ($t -match '^"",?$' -and $null -ne $current) { [void]$current.Macros.Add($null); continue }
            if ($t -match '^"",?$') { [void]$layers.Add($null); continue }
            if ($t -match '^\]\),?$') { [void]$layers.Add($current); $current = $null; continue }
            if ($t -match '^\], \d+') { break }
        }
        ,$layers
    }
    $ahk = Get-AhkConfig
}
Describe 'config parity with ahk/config.ahk' {
    It 'has the same layers in the same order' {
        $layout.Layers.Count | Should -Be $ahk.Count
        for ($i = 0; $i -lt $ahk.Count; $i++) {
            if ($null -eq $ahk[$i]) { $layout.Layers[$i] | Should -BeNullOrEmpty -Because "layer $i is blank in AHK"; continue }
            $layout.Layers[$i].Title | Should -Be $ahk[$i].Title
            $layout.Layers[$i].Icon.Name | Should -Be $ahk[$i].Icon
            $layout.Layers[$i].Macros.Count | Should -Be $ahk[$i].Macros.Count -Because "layer '$($ahk[$i].Title)' slot count"
            for ($j = 0; $j -lt $ahk[$i].Macros.Count; $j++) {
                if ($null -eq $ahk[$i].Macros[$j]) { $layout.Layers[$i].Macros[$j] | Should -BeNullOrEmpty -Because "layer '$($ahk[$i].Title)' slot $j is blank in AHK"; continue }
                $layout.Layers[$i].Macros[$j].Action | Should -Be $ahk[$i].Macros[$j].Action
                $layout.Layers[$i].Macros[$j].Name | Should -Be $ahk[$i].Macros[$j].Name
            }
        }
    }
    It 'uses the same keys and options' {
        $layout.Keys.Count | Should -Be 12; $layout.Fn.Name | Should -Be 'ScrollLock'; $layout.Fn.W | Should -Be 128
        $layout.DefaultIndex | Should -Be 10; $layout.ShowFn | Should -Be ' '; $layout.ShowMacroMarkers | Should -BeTrue; $layout.ShowLabels | Should -BeTrue
    }
    It 'references only defined command functions' { { Test-LayoutActions $layout } | Should -Not -Throw }
    It 'references only images that exist' {
        for ($s = 0; $s -lt $layout.Layers.Count; $s++) {
            if ($null -eq $layout.Layers[$s]) { continue }
            for ($i = 0; $i -lt $layout.Keys.Count; $i++) { { Get-CachedImage (Get-ButtonState $layout $s $i).Image } | Should -Not -Throw }
        }
    }
}
