# Visual Studio shortcuts (ahk/commands/custom/vsstudio.ahk).

function VsStudioShowSolutionExplorer { param($Macro) Send-Chord 'Ctrl+Alt+l' }
function VsStudioShowTestExplorer { param($Macro) Send-Chord 'Ctrl+e+t' }
function VsStudioSplitPanel { param($Macro) Send-Chord 'Ctrl+w+v' }
function VsStudioBuild { param($Macro) Send-Chord 'Ctrl+Shift+b' }
function VsStudioGoToDefinition { param($Macro) Send-Chord 'F12' }
