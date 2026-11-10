BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native', 'Interop', 'Pump', 'Assets', 'Input', 'Model', 'Overlay', 'Window', 'Engine', 'AhkSyntax', 'Send', 'WinTitle', 'WindowOps', 'Hotkeys', 'Screen', 'Sound') { . "$ps\lib\$f.ps1" }
    $rows = Get-Content "$ps\docs\ahk-builtins.md" | Where-Object { $_ -match '^\|' -and $_ -notmatch '^\|\s*-' } | ForEach-Object {
        $cells = @($_.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
        [pscustomobject]@{ Ahk = $cells[0]; PowerShell = $cells[1]; Kind = $cells[2]; Notes = $cells[3] }
    } | Where-Object { $_.Ahk -ne 'AutoHotkey' }
}
Describe 'AutoHotkey built-in map' {
    It 'names only port functions that exist' {
        $missing = foreach ($r in $rows | Where-Object Kind -eq 'port') {
            foreach ($m in [regex]::Matches($r.PowerShell, '`([A-Z][A-Za-z]*(?:-[A-Z][A-Za-z]*)?)`')) {
                if (-not (Get-Command $m.Groups[1].Value -CommandType Function -ErrorAction SilentlyContinue)) { $m.Groups[1].Value }
            }
        }
        $missing | Should -BeNullOrEmpty
    }
    It 'covers every built-in the AHK version uses' {
        $used = 'Send', 'SendInput', 'DllCall', 'Run', 'Gui', 'Click', 'GetKeyState', 'Sleep', 'WinActivate', 'WinActivateBottom', 'SetTimer', 'SendMessage', 'WinActive', 'WinWait', 'ToolTip', 'Shutdown', 'MsgBox', 'Hotkey', 'WinExist', 'OnMessage', 'MouseGetPos', 'IL_Destroy', 'RegExMatch', 'KeyWait', 'CoordMode', 'ControlGetStyle', 'ControlSetStyle', 'ControlGetPos', 'A_TickCount', 'WinSetTransColor', 'Format', 'FileExist', 'ExitApp', 'A_ScriptDir', 'A_ThisFunc', 'A_PtrSize', 'A_Index'
        $listed = $rows | ForEach-Object { $_.Ahk -split '/' } | ForEach-Object { $_.Trim().Trim('`') }
        $used | Where-Object { $listed -notcontains $_ } | Should -BeNullOrEmpty
    }
    It 'uses only the three kinds' { $rows | Where-Object { $_.Kind -notin 'port', 'native', 'not ported' } | Should -BeNullOrEmpty }
    It 'gives a reason for everything not ported' { $rows | Where-Object { $_.Kind -eq 'not ported' -and -not $_.Notes } | Should -BeNullOrEmpty }
}
