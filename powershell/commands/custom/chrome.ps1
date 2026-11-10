# Chrome commands (ahk/commands/custom/chrome.ahk).

# Opens the URL in Chrome (or just Chrome), or brings an existing Chrome window forward.
function ActivateOrOpenChrome {
    param([string]$Url = '')
    $windows = Get-ProcessWindow 'chrome.exe'
    if ($windows.Count -eq 0 -or $Url) {
        Start-Program 'chrome.exe' $Url
        $windows = Wait-ProcessWindow 'chrome.exe' 5
        if ($windows.Count -gt 0 -and $windows -notcontains [Macropad.Native]::GetForegroundWindow()) {
            [void](Set-ActiveWindow $windows[0])
        }
    } else {
        [void](Invoke-WindowActivation 'chrome.exe')
    }
}

function EnsureActiveOrOpenChrome { param($Macro) EnsureActiveOrOpen 'chrome.exe' 'chrome.exe' }

function OpenYoutube { param($Macro) ActivateOrOpenChrome 'https://www.youtube.com/' }
function OpenGoogle { param($Macro) ActivateOrOpenChrome 'https://www.google.com/' }
function ChromeOpen { param($Macro) ActivateOrOpenChrome }

function ChromeNewTab { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'Ctrl+t' }
function ChromeNewTabInGroup { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'LAlt+Shift+t' }
function ChromeOpenNewWindow { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'Ctrl+n' }
function ChromeOpenIncognitoWindow { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'Ctrl+Shift+n' }
function ChromeOpenDownloads { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'Ctrl+j' }
function ChromeOpenHistory { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'Ctrl+h' }
function ChromeOpenBookmarks { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'Ctrl+Shift+o' }
function ChromeOpenExtensions { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'Ctrl+Shift+e' }
function ChromeOpenSettings { param($Macro) EnsureActiveOrOpenChrome $Macro; Send-Chord 'Alt+e'; Send-Key 'g' }

function ChromePreviousTab { param($Macro) Send-Chord 'Ctrl+Shift+Tab' }
function ChromeNextTab { param($Macro) Send-Chord 'Ctrl+Tab' }
function ChromeDevTools { param($Macro) Send-Chord 'Ctrl+Shift+i' }
function ChromeCloseTab { param($Macro) Send-Chord 'Ctrl+w' }
function ChromeReopenClosedTab { param($Macro) Send-Chord 'Ctrl+Shift+t' }
function ChromeBookmarkPage { param($Macro) Send-Chord 'Ctrl+d' }
function ActivateOrCycleChromeAddressBar { param($Macro) Send-Chord 'Ctrl+l' }
