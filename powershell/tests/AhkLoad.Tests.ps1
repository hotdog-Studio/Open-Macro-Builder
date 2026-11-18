# The AutoHotkey version loads: /Validate reads ahk\main.ahk and everything it includes, as starting
# the macropad would, and stops before running anything. A load-time error (such as a call with too
# few arguments) prints here and fails the test. main.ahk does not set #Warn (its #Warn line is a
# comment), so AutoHotkey 2.0 keeps the warnings a user would see on, as dialogs: a variable that is
# never given a value (which is what a call of a function that does not exist is) and a line after a
# return. The test reads a file first with /include that sends those two to StdOut instead, so a
# warning prints here and fails the test at once, with no dialog. It names them, not All: All would
# also turn on LocalSameAsGlobal, which is off by default. A #Warn that main.ahk sets itself comes
# later and wins; then a warning is a dialog again and the run is cut off at Invoke-AhkScript's timeout,
# so the second test fails on any #Warn under ahk that does not send to StdOut.
BeforeAll {
    . "$PSScriptRoot\helpers\Ahk.ps1"
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
}
Describe 'The AutoHotkey version' {
    It 'loads main.ahk without an error or a warning' {
        if (-not (Get-AhkExe)) { Set-ItResult -Skipped -Because 'AutoHotkey v2 is not installed'; return }
        $warnings = Join-Path $TestDrive 'warnings-to-stdout.ahk'
        Set-Content -LiteralPath $warnings -Encoding ASCII -Value "#Warn VarUnset, StdOut`r`n#Warn Unreachable, StdOut"
        $r = Invoke-AhkScript (Join-Path $root 'ahk\main.ahk') -Validate -Include $warnings
        $r.ExitCode | Should -Be 0 -Because $r.Err
        ($r.Out + $r.Err).Trim() | Should -BeNullOrEmpty -Because 'AutoHotkey printed an error or a warning on loading main.ahk'
    }
    It 'sets #Warn nowhere under ahk, so the include above decides where warnings go' {
        # A #Warn of the scripts' own comes after the include and wins: a warning would then be a dialog
        # again, and the test above would fail only at its timeout, without the warning's text.
        $bad = foreach ($file in Get-ChildItem (Join-Path $root 'ahk') -Recurse -Filter *.ahk) {
            Select-String -LiteralPath $file.FullName -Pattern '^\s*#Warn\b' |
                Where-Object { $_.Line -notmatch '\bStdOut\b' } |
                ForEach-Object { '{0}:{1}: {2}' -f $file.FullName.Substring($root.Length + 1), $_.LineNumber, $_.Line.Trim() }
        }
        $bad | Should -BeNullOrEmpty -Because "a script's own #Warn overrides the load test's include, so a warning would open a dialog"
    }
}
