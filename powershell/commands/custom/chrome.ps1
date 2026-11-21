# Chrome commands (ahk/commands/custom/chrome.ahk).

<#
.SYNOPSIS
Switches to Chrome or starts it, or opens a web address in Chrome.
.DESCRIPTION
Without Url: when Chrome has a visible window, that window is activated; when one of Chrome's windows is already active, the bottom one comes forward instead, so pressing the key again steps through Chrome's windows. When Chrome has no visible window, Chrome is started. With Url, Chrome is started every time, with the address on its command line. After a start, up to 5 seconds are given for a Chrome window to appear, and the topmost one is activated unless one of Chrome's windows is already the active window.
.PARAMETER Url
The web address to open, such as 'https://www.google.com/'. Leave it out to switch to Chrome, or start it when it has no window.
.EXAMPLE
ActivateOrOpenChrome
.EXAMPLE
ActivateOrOpenChrome -Url 'https://www.youtube.com/'
#>
function ActivateOrOpenChrome {
    param([string]$Url = '')
    $windows = Get-ProcessWindow 'chrome.exe'
    if ($windows.Count -eq 0 -or $Url) {
        Start-Program 'chrome.exe' $Url
        $windows = Wait-ProcessWindow 'chrome.exe' 5
        # Test-WindowActive with no WinTitle gives the handle of the active window, whatever it is.
        if ($windows.Count -gt 0 -and $windows -notcontains (Test-WindowActive)) {
            [void](Set-ActiveWindow $windows[0])
        }
    } else {
        [void](Invoke-WindowActivation 'chrome.exe')
    }
}

# Makes a Chrome window the active one, starting Chrome when it has none, and returns true when a Chrome
# window is the active window at the end. The commands below send their keys only then, so the keys
# never go to another program.
function EnsureActiveOrOpenChrome { param($Macro) EnsureActiveOrOpen 'chrome.exe' 'chrome.exe' }

function OpenYoutube { param($Macro) ActivateOrOpenChrome 'https://www.youtube.com/' }
function OpenGoogle { param($Macro) ActivateOrOpenChrome 'https://www.google.com/' }
function ChromeOpen { param($Macro) ActivateOrOpenChrome }

function ChromeNewTab { param($Macro) if (EnsureActiveOrOpenChrome $Macro) { Send-Chord 'Ctrl+t' } }

# A new tab inside the tab group of the active tab, right after it, as "New tab to the right" in the tab's
# right-click menu does (no group when the active tab has none); the address bar of the new tab has the
# keyboard, as after Ctrl+T. Chrome has no shortcut for it, so no key is pressed: WM_COMMAND (0x111) with
# IDC_NEW_TAB_TO_RIGHT (35024, chrome/app/chrome_command_ids.h in Chromium) is posted to the active Chrome
# window, which runs that menu item on its active tab. Any display language, no extension, no setting.
# Nothing happens while a bubble or dialog of Chrome's has the keyboard. Windows refusing the message is an
# error, as AutoHotkey's PostMessage raises one.
function ChromeNewTabInGroup {
    param($Macro)
    if (-not (EnsureActiveOrOpenChrome $Macro)) { return }
    $chrome = Test-WindowActive 'ahk_exe chrome.exe'
    if ($chrome -eq [IntPtr]::Zero) { return }
    if ((Send-WindowMessage $chrome 0x111 35024 0 -Post) -eq 0) { throw 'Windows did not pass the new tab command to Chrome.' }
}
function ChromeOpenNewWindow { param($Macro) if (EnsureActiveOrOpenChrome $Macro) { Send-Chord 'Ctrl+n' } }
function ChromeOpenIncognitoWindow { param($Macro) if (EnsureActiveOrOpenChrome $Macro) { Send-Chord 'Ctrl+Shift+n' } }
function ChromeOpenDownloads { param($Macro) if (EnsureActiveOrOpenChrome $Macro) { Send-Chord 'Ctrl+j' } }
function ChromeOpenHistory { param($Macro) if (EnsureActiveOrOpenChrome $Macro) { Send-Chord 'Ctrl+h' } }
function ChromeOpenBookmarks { param($Macro) if (EnsureActiveOrOpenChrome $Macro) { Send-Chord 'Ctrl+Shift+o' } }

# Chrome has no shortcut for these pages, so they go through the address bar (Ctrl+L), given a moment to take the keys.

function ChromeOpenExtensions { param($Macro) if (EnsureActiveOrOpenChrome $Macro) { Send-Chord 'Ctrl+l'; Wait-Pump 100; Send-Text 'chrome://extensions'; Send-Key 'Enter' } }
function ChromeOpenSettings { param($Macro) if (EnsureActiveOrOpenChrome $Macro) { Send-Chord 'Ctrl+l'; Wait-Pump 100; Send-Text 'chrome://settings'; Send-Key 'Enter' } }

function ChromePreviousTab { param($Macro) Send-Chord 'Ctrl+Shift+Tab' }
function ChromeNextTab { param($Macro) Send-Chord 'Ctrl+Tab' }
function ChromeDevTools { param($Macro) Send-Chord 'Ctrl+Shift+i' }
function ChromeCloseTab { param($Macro) Send-Chord 'Ctrl+w' }
function ChromeReopenClosedTab { param($Macro) Send-Chord 'Ctrl+Shift+t' }
function ChromeBookmarkPage { param($Macro) Send-Chord 'Ctrl+d' }
function ActivateOrCycleChromeAddressBar { param($Macro) Send-Chord 'Ctrl+l' }
