BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native','Interop','Pump','Assets','Input','Model','Overlay','Window','Engine','AhkSyntax','WinTitle') { . "$ps\lib\$f.ps1" }
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
        $expected = Get-AhkFunctionNames 'helper.ahk','media.ahk','power.ahk','windows.ahk'
        $missing = $expected | Where-Object { -not (Get-Command $_ -CommandType Function -ErrorAction SilentlyContinue) }
        $missing | Should -BeNullOrEmpty
    }
    It 'defines every custom AHK command function' {
        $expected = @(Get-AhkFunctionNames 'custom\chrome.ahk','custom\ssh.ahk','custom\examples.ahk','custom\vscode.ahk','custom\vsstudio.ahk') + 'ShowDelayedKeyForm','ShowDelayedClickForm'
        $missing = $expected | Where-Object { -not (Get-Command $_ -CommandType Function -ErrorAction SilentlyContinue) }
        $missing | Should -BeNullOrEmpty
    }
}
Describe 'custom commands send the right chords' {
    BeforeEach { Mock Send-Chord {}; Mock Send-Key {}; Mock EnsureActiveOrOpen { $true }; Mock ActivateOrOpenChrome {} }
    It 'VsCodeSplitPanel' { VsCodeSplitPanel $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+\' } }
    It 'VsCodeRestartDebugging' { VsCodeRestartDebugging $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+Shift+F5' } }
    It 'VsCodePauseDebugging presses F6, VS Code''s Pause' { VsCodePauseDebugging $null; Should -Invoke Send-Chord -Times 1 -Exactly -ParameterFilter { $Chord -eq 'F6' } }
    It 'VsCodeAddInlineBreakpoint presses Shift+F9, VS Code''s Inline Breakpoint' { VsCodeAddInlineBreakpoint $null; Should -Invoke Send-Chord -Times 1 -Exactly -ParameterFilter { $Chord -eq 'Shift+F9' } }
    It 'VsCodeOpenTerminal presses Ctrl+Shift+backtick, VS Code''s Create New Terminal' { VsCodeOpenTerminal $null; Should -Invoke Send-Chord -Times 1 -Exactly -ParameterFilter { $Chord -eq 'Ctrl+Shift+`' } }
    It 'VsStudioShowTestExplorer presses Ctrl+E and then T alone, the two steps of Visual Studio''s shortcut' {
        $script:sent = [System.Collections.Generic.List[string]]::new()
        Mock Send-Chord { $script:sent.Add($Chord) }
        VsStudioShowTestExplorer $null
        $script:sent -join ', ' | Should -Be 'Ctrl+e, t'
    }
    It 'VsCodePeekImplementations presses Ctrl+Shift+F12' { VsCodePeekImplementations $null; Should -Invoke Send-Chord -Times 1 -Exactly -ParameterFilter { $Chord -eq 'Ctrl+Shift+F12' } }
    It 'ChromeNewTab' {
        ChromeNewTab $null
        Should -Invoke EnsureActiveOrOpen -Times 1 -Exactly
        Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+t' }
    }
    It 'ExampleOpenWebsite' { ExampleOpenWebsite $null; Should -Invoke ActivateOrOpenChrome -ParameterFilter { $Url -eq 'https://example.com/' } }
}
Describe 'SSH commands' {
    BeforeEach { Mock Start-Program {}; Mock LoadPuttySession {} }
    It 'SshMacroName opens the PuTTY session named like the macro' {
        SshMacroName ([pscustomobject]@{ Name = 'example-server'; Description = 'x' })
        Should -Invoke LoadPuttySession -Times 1 -Exactly -ParameterFilter { $Name -eq 'example-server' }
    }
    It 'SshExample opens ssh to the example server' {
        SshExample $null
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'ssh' -and $Arguments -eq 'user@server.example.com' }
    }
}
Describe 'core commands send the right chords' {
    BeforeEach { Mock Send-Chord {}; Mock Send-Key {}; Mock Start-Program {}; Mock ActivateOrOpen {} }
    It 'SnapWindowLeft' { SnapWindowLeft $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'LWin+Left' } }
    It 'NextDesktop' { NextDesktop $null; Should -Invoke Send-Chord -ParameterFilter { $Chord -eq 'Ctrl+LWin+Right' } }
    It 'NextWindow goes where Alt+Tab goes' { NextWindow $null; Should -Invoke Send-Chord -Times 1 -Exactly -ParameterFilter { $Chord -eq 'Alt+Tab' } }
    It 'PreviousWindow goes the other way' { PreviousWindow $null; Should -Invoke Send-Chord -Times 1 -Exactly -ParameterFilter { $Chord -eq 'Alt+Shift+Tab' } }
    It 'PlayPause' { PlayPause $null; Should -Invoke Send-Key -ParameterFilter { $Name -eq 'Media_Play_Pause' } }
    It 'Shutdown' { Shutdown $null; Should -Invoke Start-Program -ParameterFilter { $Program -eq 'shutdown' -and $Arguments -eq '/s /t 1' } }
}
Describe 'Shell commands' {
    BeforeEach { Mock ActivateOrOpenWindow {}; Mock ActivateOrOpen {} }
    It 'OpenPowershell finds a PowerShell console or a Windows Terminal window running PowerShell' {
        OpenPowershell $null
        Should -Invoke ActivateOrOpenWindow -Times 1 -Exactly -ParameterFilter {
            ($WinTitle -join '|') -eq 'ahk_exe powershell.exe|PowerShell ahk_exe WindowsTerminal.exe' -and $Program -eq 'powershell'
        }
    }
    It 'OpenCommandPrompt finds a Command Prompt console or a Windows Terminal window running it' {
        OpenCommandPrompt $null
        Should -Invoke ActivateOrOpenWindow -Times 1 -Exactly -ParameterFilter {
            ($WinTitle -join '|') -eq 'ahk_exe cmd.exe|Command Prompt ahk_exe WindowsTerminal.exe|cmd.exe ahk_exe WindowsTerminal.exe' -and $Program -eq 'cmd'
        }
    }
    It 'OpenSettings brings the Settings window forward, or opens Settings and then brings its window forward' {
        Mock Start-Program {}
        OpenSettings $null
        Should -Invoke ActivateOrOpenWindow -Times 1 -Exactly -ParameterFilter { ($WinTitle -join '|') -eq 'Settings ahk_exe ApplicationFrameHost.exe' -and $Program -eq 'ms-settings:' }
        Should -Invoke Start-Program -Times 0 -Exactly
    }
}
Describe 'Get-KeyNameFromKeys' {
    It 'maps WinForms key codes back to chord names' {
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Left) | Should -Be 'Left'
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::A) | Should -Be 'a'
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::F5) | Should -Be 'F5'
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Oem5) | Should -Be '\'
    }
    It 'round-trips through Get-VirtualKey' { Get-VirtualKey (Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::PageDown)) | Should -Be 0x22 }
    It 'names a symbol key by the character it types on the keyboard layout in use' {
        # en-GB: vk C0 types ', vk DF types `, and the US ' key (vk DE) types #, which the table lacks.
        Mock Get-LayoutVirtualKey { 0xC0 } -ParameterFilter { $Char -eq "'" }
        Mock Get-LayoutVirtualKey { 0xDF } -ParameterFilter { $Char -eq '`' }
        Mock Get-LayoutVirtualKey { 0xDE } -ParameterFilter { $Char -eq '#' }
        Mock Get-LayoutVirtualKey { -1 } -ParameterFilter { $Char -ne "'" -and $Char -ne '`' -and $Char -ne '#' }
        Mock Get-LayoutCharacter { '#' } -ParameterFilter { $Vk -eq 0xDE }
        Mock Get-LayoutCharacter { '' } -ParameterFilter { $Vk -ne 0xDE }
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Oem3) | Should -Be "'"
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Oem8) | Should -Be '`'
        $name = Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Oem7)
        $name | Should -Be '#'
        Get-VirtualKey $name | Should -Be 0xDE -Because 'the recorded name must press the recorded key again'
    }
    It 'keeps the WinForms name of a key whose character, as a name, does not press it again' {
        Mock Get-LayoutVirtualKey { -1 }
        Mock Get-LayoutCharacter { '' }
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Apps) | Should -Be 'Apps'
        # The key types #, but the name # presses another key (vk DE), so recording # would send that one.
        Mock Get-LayoutCharacter { '#' }
        Mock Get-LayoutVirtualKey { 0xDE } -ParameterFilter { $Char -eq '#' }
        Get-KeyNameFromKeys ([System.Windows.Forms.Keys]::Oem102) | Should -Be ([System.Windows.Forms.Keys]::Oem102).ToString() -Because '# does not press that key again'
    }
}
Describe 'File Explorer commands' {
    BeforeEach { Mock Start-Program {}; Mock Set-ActiveWindow { $true }; Mock Wait-Pump {} }
    It 'OpenFileExplorer activates an existing File Explorer window, not the taskbar' {
        Mock Find-Window { , [IntPtr[]]@([IntPtr]5) } -ParameterFilter { $WinTitle -eq 'ahk_class CabinetWClass' }
        OpenFileExplorer $null
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]5 }
        Should -Invoke Start-Program -Times 0 -Exactly
    }
    It 'OpenFileExplorer opens File Explorer when none is open' {
        Mock Find-Window { , [IntPtr[]]@() } -ParameterFilter { $WinTitle -eq 'ahk_class CabinetWClass' }
        OpenFileExplorer $null
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'explorer' }
    }
    It 'Open-ExplorerWindow opens the folder and activates the new window' {
        $script:finds = 0
        Mock Find-Window { $script:finds++; if ($script:finds -eq 1) { , [IntPtr[]]@([IntPtr]5) } else { , [IntPtr[]]@([IntPtr]5, [IntPtr]7) } } -ParameterFilter { $WinTitle -eq 'ahk_class CabinetWClass' }
        Open-ExplorerWindow 'D:\Users\Public\Documents'
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'explorer' -and $Arguments -eq 'D:\Users\Public\Documents' }
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]7 }
    }
    It 'Open-ExplorerWindow quotes a folder whose path has a comma or a space, without a closing backslash' -ForEach @(
        @{ Path = 'C:\Users\Smith, John\Documents'; Expected = '"C:\Users\Smith, John\Documents"' }
        @{ Path = 'C:\My Files\'; Expected = '"C:\My Files"' }
        @{ Path = '\\server\share\'; Expected = '\\server\share\' }
    ) {
        Mock Find-Window { , [IntPtr[]]@() } -ParameterFilter { $WinTitle -eq 'ahk_class CabinetWClass' }
        Open-ExplorerWindow $Path
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'explorer' -and $Arguments -eq $Expected }
    }
}
Describe 'Example commands' {
    BeforeEach { Mock Open-ExplorerWindow {}; Mock ActivateOrOpenWindow {}; Mock ActivateOrOpen {} }
    It 'ExampleOpenFolder opens the Documents folder that Windows names, wherever it was moved' {
        # A folder that is not under the profile, so the test fails on any PC if the path is built from USERPROFILE.
        Mock Get-DocumentsFolder { 'X:\Moved\Documents' }
        ExampleOpenFolder $null
        Should -Invoke Open-ExplorerWindow -Times 1 -Exactly -ParameterFilter { $Path -eq 'X:\Moved\Documents' }
    }
    It 'Get-DocumentsFolder asks Windows for the Documents folder' {
        Get-DocumentsFolder | Should -Be ([Environment]::GetFolderPath('MyDocuments'))
    }
    It 'OpenCalculator finds the Calculator window, which belongs to ApplicationFrameHost.exe' {
        OpenCalculator $null
        Should -Invoke ActivateOrOpenWindow -Times 1 -Exactly -ParameterFilter { ($WinTitle -join '|') -eq 'Calculator ahk_exe ApplicationFrameHost.exe' -and $Program -eq 'calc.exe' }
    }
}
