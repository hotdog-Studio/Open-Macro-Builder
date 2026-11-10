# Runs the AutoHotkey JSON parser (ahk/lib/json.ahk) through ahk/tests/json_check.ahk and checks
# what it prints. Needs AutoHotkey v2; skipped when it is not installed.
BeforeAll { . "$PSScriptRoot\helpers\Ahk.ps1" }
Describe 'AutoHotkey JSON parser' -Tag Integration {
    It 'parses objects, arrays, strings, numbers and literals and reports errors' {
        $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
        $r = Invoke-AhkScript "$root\ahk\tests\json_check.ahk"
        if ($null -eq $r) { Set-ItResult -Skipped -Because 'AutoHotkey v2 is not installed'; return }
        $r.ExitCode | Should -Be 0 -Because $r.Err
        $lines = @($r.Out -split "`r?`n" | Where-Object { $_ })
        $lines | Should -Be @(
            'len=6 a1=1 a2=2.5 a3=-300.0 t=1 f=0 null=[]'
            'string ok=1'
            'map=1 count=0 array=1 len=0'
            'nested=deep'
            'error=Expected '','' or '']'' at position 13'
            'error=Unterminated string'
        )
    }
}
