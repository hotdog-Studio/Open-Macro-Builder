BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native','Pump','Assets','Input','Model','Overlay','Window','Engine') { . "$ps\lib\$f.ps1" }
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
    It 'defines every custom AHK command function' {
        $expected = @(Get-AhkFunctionNames 'custom\chrome.ahk','custom\programs.ahk','custom\server.ahk','custom\dev.ahk','custom\vscode.ahk','custom\vsstudio.ahk') + 'ShowDelayedKeyForm','ShowDelayedClickForm'
        $missing = $expected | Where-Object { -not (Get-Command $_ -CommandType Function -ErrorAction SilentlyContinue) }
        $missing | Should -BeNullOrEmpty
    }
}
Describe 'custom commands send the right chords' {
    BeforeEach { Mock Send-Chord {}; Mock Send-Key {}; Mock EnsureActiveOrOpen {}; Mock ActivateOrOpenChrome {} }
    It 'VsCodeSplitPanel' { VsCodeSplitPanel $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+\' } }
    It 'VsCodeRestartDebugging' { VsCodeRestartDebugging $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+Shift+F5' } }
    It 'ChromeNewTab' {
        ChromeNewTab $null
        Should -Invoke EnsureActiveOrOpen -Times 1 -Exactly
        Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+t' }
    }
    It 'OpenGmail2' { OpenGmail2 $null; Should -Invoke ActivateOrOpenChrome -ParameterFilter { $Url -eq 'https://mail.google.com/mail/u/0/#inbox' } }
}
Describe 'core commands send the right chords' {
    BeforeEach { Mock Send-Chord {}; Mock Send-Key {}; Mock Start-Program {}; Mock ActivateOrOpen {} }
    It 'SnapWindowLeft' { SnapWindowLeft $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'LWin+Left' } }
    It 'NextDesktop' { NextDesktop $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+LWin+Right' } }
    It 'PlayPause' { PlayPause $null; Should -Invoke Send-Key -ParameterFilter { $Name -eq 'Media_Play_Pause' } }
    It 'Shutdown' { Shutdown $null; Should -Invoke Start-Program -ParameterFilter { $Program -eq 'shutdown' -and $Arguments -eq '/s /t 1' } }
    It 'OpenFileExplorer' { OpenFileExplorer $null; Should -Invoke ActivateOrOpen -ParameterFilter { $Exe -eq 'explorer.exe' } }
}
Describe 'Get-KeyNameFromKeys' {
    It 'maps WinForms key codes back to chord names' {
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Left) | Should -Be 'Left'
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::A) | Should -Be 'a'
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::F5) | Should -Be 'F5'
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Oem5) | Should -Be '\'
    }
    It 'round-trips through Get-VirtualKey' { Get-VirtualKey (Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::PageDown)) | Should -Be 0x22 }
}
