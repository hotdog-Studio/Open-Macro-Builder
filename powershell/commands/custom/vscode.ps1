# VS Code shortcuts (ahk/commands/custom/vscode.ahk).
# VsCodeRestartDebugging, VsCodePauseDebugging and VsCodePeekImplementations send the F-key the AHK
# version meant to send: its source typed the letters F,5 / F,1,2 because the braces were missing.

function VsCodeToggleBottomPanel { param($Macro) Send-Chord 'Ctrl+j' }
function VsCodeToggleSidebar { param($Macro) Send-Chord 'Ctrl+b' }
function VsCodeToggleZenMode { param($Macro) Send-Chord 'Ctrl+k'; Start-Sleep -Milliseconds 100; Send-Chord 'z' }
function VsCodeCloseEditor { param($Macro) Send-Chord 'Ctrl+w' }
function VsCodeReopenClosedEditor { param($Macro) Send-Chord 'Ctrl+Shift+t' }
function VsCodeNextEditor { param($Macro) Send-Chord 'Ctrl+PgDn' }
function VsCodePreviousEditor { param($Macro) Send-Chord 'Ctrl+PgUp' }
function VsCodeNextGroup { param($Macro) Send-Chord 'Ctrl+k'; Start-Sleep -Milliseconds 100; Send-Chord 'Ctrl+Right' }
function VsCodePreviousGroup { param($Macro) Send-Chord 'Ctrl+k'; Start-Sleep -Milliseconds 100; Send-Chord 'Ctrl+Left' }
function VsCodeMoveGroupLeft { param($Macro) Send-Chord 'Ctrl+k'; Start-Sleep -Milliseconds 100; Send-Chord 'Left' }
function VsCodeMoveGroupRight { param($Macro) Send-Chord 'Ctrl+k'; Start-Sleep -Milliseconds 100; Send-Chord 'Right' }
function VsCodeSearchInFiles { param($Macro) Send-Chord 'Ctrl+Shift+f' }
function VsCodeMovePanelRight { param($Macro) Send-Chord 'Ctrl+LAlt+Right' }
function VsCodeMovePanelLeft { param($Macro) Send-Chord 'Ctrl+LAlt+Left' }
function VsCodeOpenSourceControl { param($Macro) Send-Chord 'Ctrl+Shift+g' }
function VsCodeSplitPanel { param($Macro) Send-Chord 'Ctrl+\' }
function VsCodeOpenCommandPalette { param($Macro) Send-Chord 'Ctrl+Shift+p' }
function VsCodeOpenTerminal { param($Macro) Send-Chord "Ctrl+Shift+'" }
function VsCodeDebug { param($Macro) Send-Chord 'F5' }
function VsCodeAddBreakpoint { param($Macro) Send-Chord 'F9' }
function VsCodeAddInlineBreakpoint { param($Macro) Send-Chord 'Ctrl+F9' }
function VsCodeStopDebugging { param($Macro) Send-Chord 'Shift+F5' }
function VsCodeRestartDebugging { param($Macro) Send-Chord 'Ctrl+Shift+F5' }
function VsCodePauseDebugging { param($Macro) Send-Chord 'Ctrl+Shift+F5' }
function VsCodeStepInto { param($Macro) Send-Chord 'F11' }
function VsCodeStepOut { param($Macro) Send-Chord 'Shift+F11' }
function VsCodeStepOver { param($Macro) Send-Chord 'F10' }
function VsCodeGoToDefinition { param($Macro) Send-Chord 'F12' }
function VsCodePeekDefinition { param($Macro) Send-Chord 'Alt+F12' }
function VsCodeGoToReferences { param($Macro) Send-Chord 'Shift+F12' }
function VsCodePeekImplementations { param($Macro) Send-Chord 'Ctrl+Shift+F12' }
function VsCodeGoToImplementation { param($Macro) Send-Chord 'Ctrl+F12' }
