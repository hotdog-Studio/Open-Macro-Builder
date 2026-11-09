# Overlay: what each key shows (pure functions) and the WinForms window that renders it.

function Get-EmptyIconPath {
    param($Key)
    $size = "$($Key.Width)x$($Key.Height)"
    if (@('1x1', '1x2', '2x1', '2x2') -contains $size) { return Get-AssetPath "empty_$size.png" }
    Get-AssetPath 'empty.png'
}

function Get-MacroText {
    param($Macro)
    if ($null -eq $Macro) { return '' }
    "$($Macro.Name)`n$($Macro.Description)"
}

# Everything one key of the overlay shows when layer $Selected is selected (0-based indexes).
function Get-ButtonState {
    param($Layout, [int]$Selected, [int]$Index)
    $layers = @($Layout.Layers)
    $layer = $null
    if ($Index -ge 0 -and $Index -lt $layers.Count) { $layer = $layers[$Index] }
    $sel = $null
    if ($Selected -ge 0 -and $Selected -lt $layers.Count) { $sel = $layers[$Selected] }
    $macro = $null
    if ($null -ne $sel) {
        $macros = @($sel.Macros)
        if ($Index -ge 0 -and $Index -lt $macros.Count) { $macro = $macros[$Index] }
    }
    $marker = $Layout.ShowMacroMarkers -and ($null -ne $macro)
    $macroMode = ($Layout.IconAction -eq 'Macro') -or (-not $Layout.ShowLabels) -or $Layout.UseMacroIcons

    if ($null -eq $layer) {
        if ($marker) { $image = Get-EmptyIconPath @($Layout.Keys)[$Index] } else { $image = Get-AssetPath 'blank.png' }
    } else {
        $set = $layer.Icon
        if ($Layout.UseMacroIcons -and $null -ne $macro -and $null -ne $macro.Icon) { $set = $macro.Icon }
        if ($Index -eq $Selected) {
            if ($marker) { $image = $set.SelectedMacro } else { $image = $set.Selected }
        } else {
            if ($marker) { $image = $set.Macro } else { $image = $set.Layer }
        }
    }

    $layerTitle = ''
    if ($null -ne $layer) { $layerTitle = $layer.Title }
    $macroName = ''
    if ($null -ne $macro) { $macroName = $macro.Name }

    if (-not $Layout.ShowLabels) { $label = '' }
    elseif ($Layout.UseMacroIcons) { $label = $layerTitle }
    else { $label = $macroName }

    if ($macroMode) { $buttonTooltip = Get-MacroText $macro } else { $buttonTooltip = $layerTitle }
    if ($Layout.UseMacroIcons) { $labelTooltip = $layerTitle } else { $labelTooltip = Get-MacroText $macro }

    if ($macroMode) { $buttonClick = 'Macro' } else { $buttonClick = 'Layer' }
    if ($Layout.UseMacroIcons) { $labelClick = 'Layer' } else { $labelClick = 'Macro' }

    [pscustomobject]@{
        Image         = $image
        Label         = $label
        ButtonTooltip = $buttonTooltip
        LabelTooltip  = $labelTooltip
        ButtonClick   = $buttonClick
        LabelClick    = $labelClick
    }
}

# Loads each image once; a missing file fails loudly at startup instead of on the first Fn press.
function Get-CachedImage {
    param([Parameter(Mandatory)][string]$Path)
    if ($null -eq $script:ImageCache) { $script:ImageCache = @{} }
    if ($script:ImageCache.ContainsKey($Path)) { return $script:ImageCache[$Path] }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Image not found: $Path" }
    $image = [System.Drawing.Image]::FromFile($Path)
    $script:ImageCache[$Path] = $image
    $image
}
