BeforeAll {
    foreach ($f in 'Native', 'Interop', 'Assets', 'Input', 'Model', 'AhkSyntax', 'WinTitle', 'Hotkeys', 'ConfigJson') { . "$PSScriptRoot\..\lib\$f.ps1" }
    . "$PSScriptRoot\helpers\ConfigDump.ps1"
    function Act { param($m) }
    function Write-Fixture([string]$Json) { $p = Join-Path $TestDrive 'config.json'; Set-Content -LiteralPath $p -Value $Json -Encoding UTF8; $p }
    $fixture = @'
{
  "fn": { "key": "ScrollLock", "row": 2, "col": 1, "width": 2 },
  "keys": [ { "key": "F13", "row": 1, "col": 1 }, { "key": "F14", "row": 1, "col": 2, "height": 2 }, { "key": "F15", "row": 1, "col": 3 } ],
  "layers": [
    { "title": "A", "icon": "chrome", "macros": [ { "action": "Act", "name": "M0", "description": "d0", "icon": "godot" }, null, { "action": "Act", "name": "M2" } ] },
    { "title": "Hidden", "icon": "putty", "disabled": true, "macros": [] },
    null,
    { "title": "C", "icon": "putty", "macros": [] }
  ],
  "default": 3,
  "showFn": " ",
  "showMacroMarkers": true,
  "showLabels": true,
  "hotkeys": [ { "hotkey": "^!e", "action": "Act" }, { "hotkey": "^t", "action": "Act", "ifWinActive": "ahk_exe code.exe" } ],
  "hotstrings": [ { "hotstring": "::btw", "replacement": "by the way" }, { "hotstring": ":X:now", "action": "Act", "ifWinNotActive": "ahk_exe cmd.exe" } ]
}
'@
}
Describe 'Import-MacropadConfig' {
    BeforeAll { $l = Import-MacropadConfig (Write-Fixture $fixture) }
    It 'builds keys with width and height defaulting to 1' {
        $l.Keys.Count | Should -Be 3; $l.Keys[1].Height | Should -Be 2; $l.Keys[0].Width | Should -Be 1
        $l.Fn.Name | Should -Be 'ScrollLock'; $l.Fn.Width | Should -Be 2; $l.Fn.Height | Should -Be 1
    }
    It 'keeps null layers and macros as blank slots and drops disabled layers' {
        $l.Layers.Count | Should -Be 3
        $l.Layers[0].Title | Should -Be 'A'; $l.Layers[1] | Should -BeNullOrEmpty; $l.Layers[2].Title | Should -Be 'C'
        $l.Layers[0].Macros[1] | Should -BeNullOrEmpty; $l.Layers[0].Macros[2].Description | Should -Be ''
    }
    It 'reads macro fields and macro icons' {
        $m = $l.Layers[0].Macros[0]
        $m.Action | Should -Be 'Act'; $m.Name | Should -Be 'M0'; $m.Description | Should -Be 'd0'; $m.Icon.Name | Should -Be 'godot'
    }
    It 'passes the options to Layout' {
        $l.DefaultIndex | Should -Be 2; $l.ShowFn | Should -Be ' '; $l.ShowMacroMarkers | Should -BeTrue; $l.ShowLabels | Should -BeTrue
        $l.UseMacroIcons | Should -BeFalse; $l.IconAction | Should -Be 'Layer'
    }
    It 'turns showFn true into the Fn key name' { (Import-MacropadConfig (Write-Fixture ($fixture -replace '"showFn": " "', '"showFn": true'))).ShowFn | Should -Be 'ScrollLock' }
    It 'names a missing file' { { Import-MacropadConfig 'C:\nope\config.json' } | Should -Throw 'Config file not found: C:\nope\config.json' }
    It 'names the file on invalid JSON' { $p = Write-Fixture '{ "keys": [ }'; { Import-MacropadConfig $p } | Should -Throw "Invalid JSON in '$p'*" }
}
Describe 'Import-MacropadHotkeys' {
    BeforeAll { $d = @(Import-MacropadHotkeys (Write-Fixture $fixture)) }
    It 'reads hotkeys with their window context' {
        $d[0].Kind | Should -Be 'Hotkey'; $d[0].Spec | Should -Be '^!e'; $d[0].Macro.Action | Should -Be 'Act'
        $d[1].IfWinActive | Should -Be 'ahk_exe code.exe'
    }
    It 'reads replacement and execute hotstrings' {
        $d[2].Kind | Should -Be 'Hotstring'; $d[2].Replacement | Should -Be 'by the way'
        $d[3].Macro.Action | Should -Be 'Act'; $d[3].IfWinNotActive | Should -Be 'ahk_exe cmd.exe'
    }
    It 'rejects a hotstring action without the X option, and X without an action' {
        { Import-MacropadHotkeys (Write-Fixture '{ "hotstrings": [ { "hotstring": "::go", "action": "Act" } ] }') } | Should -Throw "Hotstring '::go' has an action but no X option."
        { Import-MacropadHotkeys (Write-Fixture '{ "hotstrings": [ { "hotstring": ":X:go", "replacement": "x" } ] }') } | Should -Throw "Hotstring ':X:go' has the X option but no action."
    }
    It 'returns nothing when the config has no hotkeys' { @(Import-MacropadHotkeys (Write-Fixture '{ "fn": { "key": "S" }, "keys": [], "layers": [] }')).Count | Should -Be 0 }
}
Describe 'Get-MacropadConfigDump' {
    It 'is stable for the fixture' {
        $dump = Get-MacropadConfigDump (Import-MacropadConfig (Write-Fixture $fixture)) @(Import-MacropadHotkeys (Write-Fixture $fixture))
        ($dump -split "`n")[0] | Should -Be 'fn ScrollLock 2 1 2 1'
        $dump | Should -Match 'macro 0 0 Act\|M0\|d0\|godot'
        $dump | Should -Match 'layer 1 -'
        $dump | Should -Match 'hotstring :X:now\|Act\|\|ahk_exe cmd.exe'
    }
}
