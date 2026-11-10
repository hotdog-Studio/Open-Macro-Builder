BeforeAll { . "$PSScriptRoot\..\lib\Instance.ps1"; $f = Join-Path $env:TEMP "macropad-test-$PID.pid" }
Describe 'Enter-SingleInstance' {
    AfterEach { Remove-Item $f -ErrorAction SilentlyContinue }
    It 'writes its own pid when no file exists' { Enter-SingleInstance $f; Get-Content $f | Should -Be "$PID" }
    It 'does not kill itself when the file already holds its pid' { Set-Content $f "$PID"; Enter-SingleInstance $f; Get-Content $f | Should -Be "$PID" }
    It 'overwrites a stale or garbage pid' { Set-Content $f 'garbage'; Enter-SingleInstance $f; Get-Content $f | Should -Be "$PID" }
    It 'ignores a live pid that is not a macropad' { Set-Content $f "$((Get-Process explorer)[0].Id)"; { Enter-SingleInstance $f } | Should -Not -Throw; Get-Content $f | Should -Be "$PID"; Get-Process explorer | Should -Not -BeNullOrEmpty }
}
Describe 'Exit-SingleInstance' {
    AfterEach { Remove-Item $f -ErrorAction SilentlyContinue }
    It 'removes only its own pid file' { Set-Content $f '1'; Exit-SingleInstance $f; $f | Should -Exist; Set-Content $f "$PID"; Exit-SingleInstance $f; $f | Should -Not -Exist }
}
Describe 'Test-AhkMacropadRunning' {
    It 'finds the AutoHotkey macropad by its script' {
        Test-AhkMacropadRunning @([pscustomobject]@{ Name = 'AutoHotkey64.exe'; CommandLine = '"C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe" /ErrorStdOut "C:\Repo\macropad_ahk\ahk\main.ahk"' }) | Should -BeTrue
    }
    It 'ignores other AutoHotkey scripts' {
        Test-AhkMacropadRunning @([pscustomobject]@{ Name = 'AutoHotkey64.exe'; CommandLine = '"C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe" "C:\scripts\other.ahk"' }) | Should -BeFalse
    }
    It 'is false with no processes' { Test-AhkMacropadRunning @() | Should -BeFalse }
}
Describe 'Test-MacropadCommandLine' {
    BeforeAll { $main = 'C:\Repo\macropad_ahk\powershell\main.ps1' }
    It 'matches this macropad as launch.vbs starts it' {
        Test-MacropadCommandLine "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$main`"" $main | Should -BeTrue
        Test-MacropadCommandLine "powershell -file $($main.ToUpperInvariant())" $main | Should -BeTrue
    }
    It 'ignores an editor that has main.ps1 open' {
        Test-MacropadCommandLine "`"C:\Program Files\Microsoft VS Code\Code.exe`" `"$main`"" $main | Should -BeFalse
    }
    It 'ignores another copy of main.ps1' { Test-MacropadCommandLine 'powershell.exe -File "D:\other\main.ps1"' $main | Should -BeFalse }
    It 'defaults to the main.ps1 beside lib' {
        $real = (Resolve-Path "$PSScriptRoot\..\main.ps1").Path
        Test-MacropadCommandLine "powershell.exe -File `"$real`"" | Should -BeTrue
    }
}
