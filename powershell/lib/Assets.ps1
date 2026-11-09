# The only file allowed to know where the shared image folder lives.
# Every image path in the PowerShell macropad comes from Get-AssetPath.

function Get-AssetPath {
    param([Parameter(Mandatory)][string]$Relative)
    # $PSScriptRoot inside a function is the folder of the file that defined it (powershell\lib),
    # so this resolves the same way whether dot-sourced from main.ps1 or from a test.
    $root = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'img'
    Join-Path $root ($Relative -replace '/', '\')
}
