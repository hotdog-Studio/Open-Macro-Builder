# The Chrome commands (powershell/commands/custom/chrome.ps1), with every function that starts a
# program, looks at windows, sends keys or posts a window message mocked, so nothing starts, no key is
# pressed and no message is posted.
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'Window', 'WinTitle', 'WindowOps', 'AhkSyntax', 'Send') { . "$ps\lib\$f.ps1" }
    . "$ps\commands\helper.ps1"
    . "$ps\commands\custom\chrome.ps1"
}
Describe 'ActivateOrOpenChrome' {
    BeforeEach {
        Mock Start-Program {}; Mock Set-ActiveWindow { $true }; Mock Invoke-WindowActivation { $true }
        Mock Test-WindowActive { [IntPtr]99 }
    }
    It 'switches to Chrome without starting it when Chrome has a window' {
        Mock Get-ProcessWindow { , [IntPtr[]]@([IntPtr]5) }
        ActivateOrOpenChrome
        Should -Invoke Invoke-WindowActivation -Times 1 -Exactly -ParameterFilter { $Exe -eq 'chrome.exe' }
        Should -Invoke Start-Program -Times 0 -Exactly
    }
    It 'starts Chrome when it has no window, waits up to 5 seconds and activates the window that appears' {
        Mock Get-ProcessWindow { , [IntPtr[]]@() }
        Mock Wait-ProcessWindow { , [IntPtr[]]@([IntPtr]5, [IntPtr]7) }
        ActivateOrOpenChrome
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'chrome.exe' -and $Arguments -eq '' }
        Should -Invoke Wait-ProcessWindow -Times 1 -Exactly -ParameterFilter { $Exe -eq 'chrome.exe' -and $TimeoutSeconds -eq 5 }
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]5 }
    }
    It 'starts Chrome with the address every time, even when Chrome has a window' {
        Mock Get-ProcessWindow { , [IntPtr[]]@([IntPtr]5) }
        Mock Wait-ProcessWindow { , [IntPtr[]]@([IntPtr]5) }
        ActivateOrOpenChrome -Url 'https://a.test/?x=1&y=2'
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'chrome.exe' -and $Arguments -eq 'https://a.test/?x=1&y=2' }
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]5 }
    }
    It 'leaves the active Chrome window alone after opening an address' {
        Mock Get-ProcessWindow { , [IntPtr[]]@([IntPtr]5, [IntPtr]7) }
        Mock Wait-ProcessWindow { , [IntPtr[]]@([IntPtr]5, [IntPtr]7) }
        Mock Test-WindowActive { [IntPtr]7 }
        ActivateOrOpenChrome 'https://example.com/'
        Should -Invoke Set-ActiveWindow -Times 0 -Exactly
    }
    It 'activates nothing when no Chrome window appears' {
        Mock Get-ProcessWindow { , [IntPtr[]]@() }
        Mock Wait-ProcessWindow { , [IntPtr[]]@() }
        ActivateOrOpenChrome 'https://example.com/'
        Should -Invoke Set-ActiveWindow -Times 0 -Exactly
    }
}
Describe 'Chrome commands send their keys only to Chrome' {
    BeforeEach {
        $script:sent = [System.Collections.Generic.List[string]]::new()
        Mock Send-Chord { $script:sent.Add("chord $Chord") }
        Mock Send-Key { $script:sent.Add("key $Name") }
        Mock Send-Text { $script:sent.Add("text $Text") }
        Mock Send-WindowMessage { $script:sent.Add("message $Hwnd $Msg $WParam $LParam post=$([bool]$Post)"); 1 }
        Mock Test-WindowActive { [IntPtr]42 }
        Mock Wait-Pump {}
    }
    It '<Command> asks EnsureActiveOrOpen for chrome.exe and sends nothing when Chrome is not active' -ForEach @(
        @{ Command = 'ChromeNewTab' }, @{ Command = 'ChromeNewTabInGroup' }, @{ Command = 'ChromeOpenNewWindow' }, @{ Command = 'ChromeOpenIncognitoWindow' },
        @{ Command = 'ChromeOpenDownloads' }, @{ Command = 'ChromeOpenHistory' }, @{ Command = 'ChromeOpenBookmarks' },
        @{ Command = 'ChromeOpenExtensions' }, @{ Command = 'ChromeOpenSettings' }
    ) {
        Mock EnsureActiveOrOpen { $false }
        & $Command $null
        Should -Invoke EnsureActiveOrOpen -Times 1 -Exactly -ParameterFilter { $Exe -eq 'chrome.exe' -and $Program -eq 'chrome.exe' }
        $script:sent.Count | Should -Be 0
    }
    It 'ChromeNewTabInGroup posts Chrome''s command IDC_NEW_TAB_TO_RIGHT (WM_COMMAND 35024) to the active Chrome window, and presses no key' {
        Mock EnsureActiveOrOpen { $true }
        ChromeNewTabInGroup $null
        $script:sent -join ' | ' | Should -Be 'message 42 273 35024 0 post=True'
        Should -Invoke Test-WindowActive -Times 1 -Exactly -ParameterFilter { $WinTitle -eq 'ahk_exe chrome.exe' }
    }
    It 'ChromeNewTabInGroup posts nothing when Chrome is no longer the active window after the guard' {
        Mock EnsureActiveOrOpen { $true }
        Mock Test-WindowActive { [IntPtr]::Zero }
        ChromeNewTabInGroup $null
        $script:sent.Count | Should -Be 0
    }
    It 'ChromeNewTabInGroup raises an error when Windows does not take the message, as AutoHotkey''s PostMessage does' {
        Mock EnsureActiveOrOpen { $true }
        Mock Send-WindowMessage { 0 }
        { ChromeNewTabInGroup $null } | Should -Throw '*new tab command*'
    }
    It 'EnsureActiveOrOpenChrome passes on whether Chrome is active' {
        Mock EnsureActiveOrOpen { $true }
        EnsureActiveOrOpenChrome $null | Should -BeTrue
        Mock EnsureActiveOrOpen { $false }
        EnsureActiveOrOpenChrome $null | Should -BeFalse
    }
    It '<Command> sends <Expected> when Chrome is active' -ForEach @(
        @{ Command = 'ChromeNewTab'; Expected = 'chord Ctrl+t' }
        @{ Command = 'ChromeOpenNewWindow'; Expected = 'chord Ctrl+n' }
        @{ Command = 'ChromeOpenIncognitoWindow'; Expected = 'chord Ctrl+Shift+n' }
        @{ Command = 'ChromeOpenDownloads'; Expected = 'chord Ctrl+j' }
        @{ Command = 'ChromeOpenHistory'; Expected = 'chord Ctrl+h' }
        @{ Command = 'ChromeOpenBookmarks'; Expected = 'chord Ctrl+Shift+o' }
    ) {
        Mock EnsureActiveOrOpen { $true }
        & $Command $null
        $script:sent -join ' | ' | Should -Be $Expected
    }
    It '<Command> sends <Expected> to the active window' -ForEach @(
        @{ Command = 'ChromePreviousTab'; Expected = 'chord Ctrl+Shift+Tab' }
        @{ Command = 'ChromeNextTab'; Expected = 'chord Ctrl+Tab' }
        @{ Command = 'ChromeDevTools'; Expected = 'chord Ctrl+Shift+i' }
        @{ Command = 'ChromeCloseTab'; Expected = 'chord Ctrl+w' }
        @{ Command = 'ChromeReopenClosedTab'; Expected = 'chord Ctrl+Shift+t' }
        @{ Command = 'ChromeBookmarkPage'; Expected = 'chord Ctrl+d' }
        @{ Command = 'ActivateOrCycleChromeAddressBar'; Expected = 'chord Ctrl+l' }
    ) {
        Mock EnsureActiveOrOpen { $true }
        & $Command $null
        $script:sent -join ' | ' | Should -Be $Expected
        Should -Invoke EnsureActiveOrOpen -Times 0 -Exactly
    }
    It '<Command> goes to <Address> through the address bar, with a pause for the address bar to take the keys' -ForEach @(
        @{ Command = 'ChromeOpenSettings'; Address = 'chrome://settings' }
        @{ Command = 'ChromeOpenExtensions'; Address = 'chrome://extensions' }
    ) {
        Mock EnsureActiveOrOpen { $true }
        Mock Wait-Pump { $script:sent.Add("wait $Milliseconds") }
        & $Command $null
        $script:sent -join ' | ' | Should -Be "chord Ctrl+l | wait 100 | text $Address | key Enter"
    }
}
