# Windows shell commands and window management chords (ahk/commands/windows.ahk).

function OpenFileExplorer {
    param($Macro)
    $windows = Get-ExplorerWindows
    if ($windows.Count -gt 0) { [void](Set-ActiveWindow (Select-WindowToActivate $windows ([Macropad.Native]::GetForegroundWindow()))) }
    else { Open-ExplorerWindow }
}
# Windows 11 shows a shell in Windows Terminal by default, and then its window belongs to WindowsTerminal.exe:
# such a window counts when its title (the shell's, or its tab's) names the shell. Best effort: a title the
# shell or the user changed, or a translated one, is not found, and the key opens another shell.

function OpenPowershell { param($Macro) ActivateOrOpenWindow -WinTitle 'ahk_exe powershell.exe', 'PowerShell ahk_exe WindowsTerminal.exe' -Program 'powershell' }
function OpenCommandPrompt { param($Macro) ActivateOrOpenWindow -WinTitle 'ahk_exe cmd.exe', 'Command Prompt ahk_exe WindowsTerminal.exe', 'cmd.exe ahk_exe WindowsTerminal.exe' -Program 'cmd' }
function OpenTaskManager { param($Macro) ActivateOrOpen 'taskmgr.exe' 'taskmgr' }
function OpenControlPanel { param($Macro) Start-Program 'control' }
function OpenSettings { param($Macro) Start-Program 'ms-settings:' }
function OpenServices { param($Macro) Start-Program 'services.msc' }
function SnippingTool { param($Macro) Start-Program 'ms-screenclip:' }

function SnapWindowTop { param($Macro) Send-Chord 'LWin+LAlt+Up' }
function SnapWindowBottom { param($Macro) Send-Chord 'LWin+LAlt+Down' }
function SnapWindowLeft { param($Macro) Send-Chord 'LWin+Left' }
function SnapThirdsLeft { param($Macro) Send-Chord 'LWin+LAlt+Left' }
function SnapWindowRight { param($Macro) Send-Chord 'LWin+Right' }
function SnapThirdsRight { param($Macro) Send-Chord 'LWin+LAlt+Right' }
function MoveWindowUp { param($Macro) Send-Chord 'LWin+Up' }
function MoveWindowDown { param($Macro) Send-Chord 'LWin+Down' }
# Next goes where Alt+Tab goes; previous goes the other way through the list.

function NextWindow { param($Macro) Send-Chord 'Alt+Tab' }
function PreviousWindow { param($Macro) Send-Chord 'Alt+Shift+Tab' }
function FocusWindow { param($Macro) Send-Chord 'LWin+Home' }
function CloseWindow { param($Macro) Send-Chord 'Alt+F4' }
function CreateDesktop { param($Macro) Send-Chord 'LWin+Ctrl+d' }
function CloseDesktop { param($Macro) Send-Chord 'LWin+Ctrl+F4' }
function NextDesktop { param($Macro) Send-Chord 'Ctrl+LWin+Right' }
function PreviousDesktop { param($Macro) Send-Chord 'Ctrl+LWin+Left' }
function ShowDesktop { param($Macro) Send-Chord 'LWin+d' }
function NextScreen { param($Macro) Send-Chord 'LWin+Shift+Right' }
function PreviousScreen { param($Macro) Send-Chord 'LWin+Shift+Left' }
function TaskView { param($Macro) Send-Chord 'LWin+Tab' }
function PrintScreen { param($Macro) Send-Chord 'PrintScreen' }
function PrintActiveWindow { param($Macro) Send-Chord 'Alt+PrintScreen' }
function MoveFocusLeft { param($Macro) Send-Chord 'Left' }
function Enter { param($Macro) Send-Chord 'Enter' }
function Escape { param($Macro) Send-Chord 'Escape' }
function MoveFocusRight { param($Macro) Send-Chord 'Right' }
