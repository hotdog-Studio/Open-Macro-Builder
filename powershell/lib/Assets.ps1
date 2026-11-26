# The only file allowed to know where the shared image folder lives.
# Every image path in the PowerShell macropad comes from Get-AssetPath or Get-IconSetDir.

# The folder that holds powershell, img and local. $PSScriptRoot inside a function is the folder of
# the file that defined it (powershell\lib), so this resolves the same way whether dot-sourced from
# main.ps1 or from a test.
function Get-AssetRoot {
    Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
}

function Get-AssetPath {
    param([Parameter(Mandatory)][string]$Relative)
    Join-Path (Join-Path (Get-AssetRoot) 'img') ($Relative -replace '/', '\')
}

# The folder of an icon set: local\img\<name> when it holds a layer.png, else img\<name>.
function Get-IconSetDir {
    param([Parameter(Mandatory)][string]$Name)
    $personal = Join-Path (Get-AssetRoot) "local\img\$Name"
    if (Test-Path -LiteralPath (Join-Path $personal 'layer.png') -PathType Leaf) { return $personal }
    Get-AssetPath $Name
}

# The image for a key of w x h units: <base>_<w>x<h>.png when that file exists, else the base file.
function Get-SizedAssetPath {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][int]$Width, [Parameter(Mandatory)][int]$Height)
    $sized = $Path -replace '\.png$', "_${Width}x${Height}.png"
    if (Test-Path -LiteralPath $sized -PathType Leaf) { return $sized }
    $Path
}
