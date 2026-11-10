# Example commands (ahk/commands/custom/examples.ahk): small, generic commands to copy from. Your own
# commands belong in local/powershell/commands, which git ignores (see the readme), so personal
# paths, hosts and accounts stay on your PC.

function ExampleOpenWebsite { param($Macro) ActivateOrOpenChrome 'https://example.com/' }
function ExampleOpenProgram { param($Macro) ActivateOrOpen 'notepad.exe' 'notepad.exe' }
function OpenCalculator { param($Macro) ActivateOrOpen 'Calculator.exe' 'C:\Windows\System32\calc.exe' }
function ExampleOpenFolder { param($Macro) Open-ExplorerWindow (Join-Path $env:USERPROFILE 'Documents') }
