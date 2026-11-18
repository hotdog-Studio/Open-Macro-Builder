# The AutoHotkey version loads: /Validate reads ahk\main.ahk and everything it includes, as starting
# the macropad would, and stops before running anything. A load-time error (such as a call with too
# few arguments, or a call of a function that does not exist) prints here and fails the test.
# Warnings are not checked: main.ahk leaves #Warn off.
BeforeAll {
    . "$PSScriptRoot\helpers\Ahk.ps1"
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
}
Describe 'The AutoHotkey version' {
    It 'loads main.ahk without an error' {
        if (-not (Get-AhkExe)) { Set-ItResult -Skipped -Because 'AutoHotkey v2 is not installed'; return }
        $r = Invoke-AhkScript (Join-Path $root 'ahk\main.ahk') -Validate
        $r.ExitCode | Should -Be 0 -Because $r.Out
        ($r.Out + $r.Err).Trim() | Should -BeNullOrEmpty
    }
}
