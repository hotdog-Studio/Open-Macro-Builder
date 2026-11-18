# The AutoHotkey commands and helpers, run by check scripts in ahk\tests with the stand-ins of
# ahk\tests\standins.ahk in place of every built-in that acts (Run, Send, WinActivate, ...), so
# nothing starts, no key is sent and no window moves. Each check prints "case=what happened" lines;
# this file holds the lines each check must print, and fails on a missing, extra or different line.
BeforeDiscovery {
    $Checks = @(
        @{ Script = 'helper_check.ahk'; Expected = [ordered]@{
                'program'                           = '"notepad"'
                'program with arguments'            = '"chrome.exe" --new-window https://x.test/?a=1&b=2'
                'program with spaces'               = '"C:\Program Files\My App\app.exe" --open "C:\My Files\a.txt"'
                'program with 0'                    = '"C:\My Scripts\build.bat" 0'
                'python'                            = 'python "C:\My Scripts\backup.py"'
                'python with arguments'             = 'python "C:\My Scripts\backup.py" --quick --to D:\x&y'
                'RunPythonScript'                   = 'Run|python "C:\My Scripts\backup.py"'
                'RunPythonScript with arguments'    = 'Run|python "C:\My Scripts\backup.py" --quick'
                'RunPowerShellScript'               = 'Run|powershell -NoProfile -ExecutionPolicy Bypass -File "C:\My Scripts\cleanup.ps1"'
                'RunPowerShellScript with arguments' = 'Run|powershell -NoProfile -ExecutionPolicy Bypass -File "C:\My Scripts\cleanup.ps1" -Force'
                'RunBatchScript'                    = 'Run|"C:\My Scripts\build.bat" 0'
                'RunPythonScript example'           = 'Run|python "C:\Scripts\backup.py"'
                'RunPowerShellScript example'       = 'Run|powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Scripts\cleanup.ps1"'
                'RunBatchScript example'            = 'Run|"C:\Scripts\build.bat"'
                'ActivateOrOpen starts'             = 'WinExist|ahk_exe macropad-check.exe ; Run|"macropad-check.exe" --a --b https://x.test/?a=1&b=2 ; WinWait|ahk_exe macropad-check.exe|5 ; WinActivate|'
                'Open starts'                       = 'Run|"C:\Program Files\Macropad Check\check.exe" --a ; WinWait|ahk_exe macropad-check.exe|5 ; WinActivate|'
                'EnsureActiveOrOpen starts'         = 'WinExist|ahk_exe macropad-check.exe ; Run|"macropad-check.exe" 0 ; WinWait|ahk_exe macropad-check.exe|5 ; WinActivate|'
            }
        }
    )
}
BeforeAll {
    . "$PSScriptRoot\helpers\Ahk.ps1"
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $tests = Join-Path $root 'ahk\tests'
    # Built-ins that act on the desktop (or wait); a command file a check includes may use one only
    # when standins.ahk, or the file itself, defines a function of that name.
    $Acting = 'Run', 'RunWait', 'Send', 'SendInput', 'SendEvent', 'SendPlay', 'SendText', 'Click', 'MouseClick', 'MouseMove',
        'WinActivate', 'WinActivateBottom', 'WinClose', 'WinKill', 'WinMinimize', 'WinMinimizeAll', 'WinMaximize', 'WinRestore',
        'WinMove', 'WinWait', 'WinWaitActive', 'WinWaitClose', 'MsgBox', 'InputBox', 'DllCall', 'Shutdown', 'SendMessage',
        'PostMessage', 'ProcessClose', 'ControlSend', 'ControlClick', 'Sleep', 'KeyWait'
    function Get-DefinedAhkFunction([string]$Path) {
        Get-Content -LiteralPath $Path | ForEach-Object { if ($_ -match '^(\w+)\(') { $Matches[1] } }
    }
}
Describe 'AutoHotkey check <Script>' -ForEach $Checks {
    BeforeAll {
        $path = Join-Path $tests $Script
        $included = @(Get-Content -LiteralPath $path | ForEach-Object { if ($_ -match '^#Include\s+(.+?)\s*$') { Join-Path $tests $Matches[1] } })
    }
    It 'has a stand-in for every acting built-in its command files use' {
        $defined = @(foreach ($file in $included) { Get-DefinedAhkFunction $file })
        $bad = foreach ($file in $included | Where-Object { $_ -notlike '*\standins.ahk' }) {
            $words = [regex]::Matches((Get-Content -LiteralPath $file -Raw), '\b[A-Za-z]\w*\b') | ForEach-Object Value | Sort-Object -Unique
            foreach ($w in $words) { if ($Acting -ccontains $w -and $defined -cnotcontains $w) { "$(Split-Path $file -Leaf): $w" } }
        }
        $bad | Should -BeNullOrEmpty
    }
    It 'prints what each case should do' {
        if (-not (Get-AhkExe)) { Set-ItResult -Skipped -Because 'AutoHotkey v2 is not installed'; return }
        $r = Invoke-AhkScript $path
        $r.ExitCode | Should -Be 0 -Because ($r.Out + $r.Err)
        $actual = [ordered]@{}
        foreach ($line in ($r.Out -split "`r?`n" | Where-Object { $_ -ne '' })) {
            $at = $line.IndexOf('=')
            $actual[$line.Substring(0, $at)] = $line.Substring($at + 1)
        }
        $bad = foreach ($case in $Expected.Keys) {
            if (-not $actual.Contains($case)) { "missing: $case" }
            elseif ($actual[$case] -cne $Expected[$case]) { "$case`n    expected: $($Expected[$case])`n    actual:   $($actual[$case])" }
        }
        $bad += foreach ($case in $actual.Keys) { if (-not $Expected.Contains($case)) { "not expected: $case=$($actual[$case])" } }
        $bad | Should -BeNullOrEmpty
    }
}
