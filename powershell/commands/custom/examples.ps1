# Example commands (ahk/commands/custom/examples.ahk): small, generic commands to copy from. Your own
# commands belong in local/powershell/commands, which git ignores (see the readme), so personal
# paths, hosts and accounts stay on your PC.

function ExampleOpenWebsite { param($Macro) ActivateOrOpenChrome 'https://example.com/' }
function ExampleOpenProgram { param($Macro) ActivateOrOpen 'notepad.exe' 'notepad.exe' }

# Calculator is a Store app: its window belongs to ApplicationFrameHost.exe and its title is translated, so
# it is found by the app's application id, in any display language (Get-StartApps lists every app's id).

function OpenCalculator { param($Macro) ActivateOrOpenApp 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' 'calc.exe' }

# Windows says where Documents is (OneDrive or another drive may hold it); tests replace this lookup.

function Get-DocumentsFolder { [Environment]::GetFolderPath('MyDocuments') }
function ExampleOpenFolder { param($Macro) Open-ExplorerWindow (Get-DocumentsFolder) }
