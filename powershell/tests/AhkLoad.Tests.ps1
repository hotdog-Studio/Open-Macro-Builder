# The AutoHotkey version loads: /Validate reads ahk\main.ahk and everything it includes, as starting
# the macropad would, and stops before running anything. A load-time error (such as a call with too
# few arguments) prints here and fails the test. main.ahk has no #Warn line, so AutoHotkey 2.0 keeps
# its warnings on, all but LocalSameAsGlobal: among them a variable that is never given a value (which
# is what a call of a function that does not exist is) and a line after a return. Such a warning opens
# a dialog, even with /ErrorStdOut, and prints nothing; Invoke-AhkScript cuts the run off at its
# timeout and the test fails then.
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
