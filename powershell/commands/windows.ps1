# Windows shell commands and window management chords (ahk/commands/windows.ahk).

function OpenFileExplorer { param($Macro) ActivateOrOpen 'explorer.exe' 'explorer' }
function OpenPowershell { param($Macro) ActivateOrOpen 'powershell.exe' 'powershell' }
function OpenCommandPrompt { param($Macro) ActivateOrOpen 'cmd.exe' 'cmd' }
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
function NextWindow { param($Macro) Send-Chord 'Alt+Shift+Tab' }
function PreviousWindow { param($Macro) Send-Chord 'Alt+Tab' }
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
