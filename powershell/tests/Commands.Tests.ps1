BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native','Assets','Input','Model','Overlay','Window','Engine') { . "$ps\lib\$f.ps1" }
    Get-ChildItem "$ps\commands" -Recurse -Filter *.ps1 | ForEach-Object { . $_.FullName }
    $ahk = Join-Path (Split-Path $ps -Parent) 'ahk\commands'
    function Get-AhkFunctionNames([string[]]$Files) {
        foreach ($file in $Files) {
            Get-Content (Join-Path $ahk $file) | ForEach-Object { if ($_ -match '^(\w+)\s*\(') { $Matches[1] } }
        }
    }
}
Describe 'parity with ahk/commands' {
    It 'defines every core AHK command function' {
        $expected = Get-AhkFunctionNames 'helper.ahk','media.ahk','power.ahk','windows.ahk' | Where-Object { $_ -ne 'EncodeInteger' }
        $missing = $expected | Where-Object { -not (Get-Command $_ -CommandType Function -ErrorAction SilentlyContinue) }
        $missing | Should -BeNullOrEmpty
    }
}
Describe 'core commands send the right chords' {
    BeforeEach { Mock Send-Chord {}; Mock Send-Key {}; Mock Start-Program {}; Mock ActivateOrOpen {} }
    It 'SnapWindowLeft' { SnapWindowLeft $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'LWin+Left' } }
    It 'NextDesktop' { NextDesktop $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+LWin+Right' } }
    It 'PlayPause' { PlayPause $null; Should -Invoke Send-Key -ParameterFilter { $Name -eq 'Media_Play_Pause' } }
    It 'Shutdown' { Shutdown $null; Should -Invoke Start-Program -ParameterFilter { $Program -eq 'shutdown' -and $Arguments -eq '/s /t 1' } }
    It 'OpenFileExplorer' { OpenFileExplorer $null; Should -Invoke ActivateOrOpen -ParameterFilter { $Exe -eq 'explorer.exe' } }
}
