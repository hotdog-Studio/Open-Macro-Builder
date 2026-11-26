# Overlay: what each key shows (pure functions) and the WinForms window that renders it.

function Get-EmptyIconPath {
    param($Key)
    Get-SizedAssetPath (Get-AssetPath 'empty.png') $Key.Width $Key.Height
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
            if ($marker) { $state = 'SelectedMacro' } else { $state = 'Selected' }
        } else {
            if ($marker) { $state = 'Macro' } else { $state = 'Layer' }
        }
        $image = Get-IconImage $set $state @($Layout.Keys)[$Index]
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
        Macro         = $macro
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

function Get-OverlayColor {
    param([ValidateSet('Transparent', 'LabelBack', 'Text')][string]$Name)
    switch ($Name) {
        'Transparent' { [System.Drawing.Color]::FromArgb(1, 1, 1) }
        'LabelBack' { [System.Drawing.Color]::FromArgb(0x10, 0x10, 0x10) }
        'Text' { [System.Drawing.Color]::FromArgb(0xFE, 0xFE, 0xFE) }
    }
}

function New-Overlay {
    param($Layout)
    $trans = Get-OverlayColor 'Transparent'
    $keys = @($Layout.Keys)

    $form = [Macropad.OverlayForm]::new()
    $form.FormBorderStyle = 'None'
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.StartPosition = 'CenterScreen'
    $form.BackColor = $trans
    $form.TransparencyKey = $trans
    $form.Font = New-Object System.Drawing.Font('Consolas', 8, ([System.Drawing.FontStyle]::Bold -bor [System.Drawing.FontStyle]::Italic))
    $form.ForeColor = Get-OverlayColor 'Text'

    $sized = @($keys)
    if ($Layout.ShowFn -ne '') { $sized += $Layout.Fn }
    $width = 0; $height = 0
    foreach ($k in $sized) {
        $width = [math]::Max($width, $k.X + $k.W)
        $height = [math]::Max($height, $k.Y + $k.H)
    }
    $form.ClientSize = New-Object System.Drawing.Size($width, $height)

    $toolTip = New-Object System.Windows.Forms.ToolTip
    $toolTip.ShowAlways = $true   # the overlay is never the active window

    # Built before the controls so each control's Tag can point back at it.
    $overlay = [pscustomobject]@{
        Form     = $form
        Buttons  = $null
        Labels   = $null
        FnButton = $null
        FnLabel  = $null
        ToolTip  = $toolTip
        Layout   = $Layout
        Selected = -1
        RunMacro = { param($Macro) }
    }

    # Shared click handler: runs in whatever scope the message loop is in, so it only
    # uses the sender's Tag and top-level functions (see Global Constraints).
    $onClick = {
        param($sender, $e)
        $tag = $sender.Tag
        $o = $tag.Overlay
        $state = Get-ButtonState $o.Layout $o.Selected $tag.Index
        if ($tag.Kind -eq 'Label') { $action = $state.LabelClick } else { $action = $state.ButtonClick }
        if ($action -eq 'Layer') {
            [void](Select-Layer $o $tag.Index)
        } elseif ($null -ne $state.Macro) {
            & $o.RunMacro $state.Macro
        }
    }

    $buttons = [System.Collections.Generic.List[System.Windows.Forms.PictureBox]]::new()
    $labels = [System.Collections.Generic.List[System.Windows.Forms.Label]]::new()
    for ($i = 0; $i -lt $keys.Count; $i++) {
        $k = $keys[$i]
        $label = New-Object System.Windows.Forms.Label
        $label.SetBounds($k.Label.X, $k.Label.Y, $k.Label.W, $k.Label.H)
        $label.TextAlign = 'MiddleCenter'
        $label.UseMnemonic = $false
        $label.BackColor = $trans
        $label.Tag = @{ Overlay = $overlay; Index = $i; Kind = 'Label' }
        $label.add_Click($onClick)
        $labels.Add($label)

        $button = New-Object System.Windows.Forms.PictureBox
        $button.SetBounds($k.X, $k.Y, $k.W, $k.H)
        $button.SizeMode = 'StretchImage'
        $button.BackColor = $trans
        $button.Tag = @{ Overlay = $overlay; Index = $i; Kind = 'Button' }
        $button.add_Click($onClick)
        $buttons.Add($button)
    }
    $overlay.Buttons = $buttons.ToArray()
    $overlay.Labels = $labels.ToArray()
    $form.Controls.AddRange([System.Windows.Forms.Control[]]$overlay.Labels)
    $form.Controls.AddRange([System.Windows.Forms.Control[]]$overlay.Buttons)

    if ($Layout.ShowFn -ne '') {
        $fn = $Layout.Fn
        $fnLabel = New-Object System.Windows.Forms.Label
        $fnLabel.SetBounds($fn.Label.X, $fn.Label.Y, $fn.Label.W, $fn.Label.H)
        $fnLabel.TextAlign = 'MiddleCenter'
        $fnLabel.UseMnemonic = $false
        $fnLabel.Text = $Layout.ShowFn
        if ($Layout.ShowFn -ne ' ') { $fnLabel.BackColor = Get-OverlayColor 'LabelBack' } else { $fnLabel.BackColor = $trans }
        $fnButton = New-Object System.Windows.Forms.PictureBox
        $fnButton.SetBounds($fn.X, $fn.Y, $fn.W, $fn.H)
        $fnButton.SizeMode = 'StretchImage'
        $fnButton.BackColor = $trans
        $fnButton.Image = Get-CachedImage (Get-EmptyIconPath $fn)
        $form.Controls.Add($fnLabel)
        $form.Controls.Add($fnButton)
        $overlay.FnLabel = $fnLabel
        $overlay.FnButton = $fnButton
    }

    # Load every image any selection can show now, so a missing file fails at startup.
    $layers = @($Layout.Layers)
    for ($s = 0; $s -lt $layers.Count; $s++) {
        if ($null -eq $layers[$s]) { continue }
        for ($i = 0; $i -lt $keys.Count; $i++) { [void](Get-CachedImage (Get-ButtonState $Layout $s $i).Image) }
    }

    Update-Overlay $overlay
    $overlay
}

function Update-Overlay {
    param($Overlay)
    $trans = Get-OverlayColor 'Transparent'
    $back = Get-OverlayColor 'LabelBack'
    for ($i = 0; $i -lt $Overlay.Buttons.Count; $i++) {
        $state = Get-ButtonState $Overlay.Layout $Overlay.Selected $i
        $Overlay.Buttons[$i].Image = Get-CachedImage $state.Image
        $Overlay.Labels[$i].Text = $state.Label
        if ($state.Label -ne '') { $Overlay.Labels[$i].BackColor = $back } else { $Overlay.Labels[$i].BackColor = $trans }
        $Overlay.ToolTip.SetToolTip($Overlay.Buttons[$i], $state.ButtonTooltip)
        $Overlay.ToolTip.SetToolTip($Overlay.Labels[$i], $state.LabelTooltip)
    }
}

function Select-Layer {
    param($Overlay, [int]$Index)
    $layers = @($Overlay.Layout.Layers)
    if ($Index -lt 0 -or $Index -ge $layers.Count -or $null -eq $layers[$Index]) { return $false }
    $Overlay.Selected = $Index
    Update-Overlay $Overlay
    $true
}

function Show-Overlay {
    param($Overlay)
    $Overlay.Form.Show()
}

# Hides the overlay, and the tooltip that shows over it. The tooltip is a window of its own (a tooltip
# control, not a child of the form), so hiding the form alone leaves a tip that is showing on the screen
# until the control's own AutoPopDelay (5 s) ends it. So the ToolTip is switched off and on again:
# Active = $false sends the control TTM_ACTIVATE (0x401) with 0 once its window exists: the Active
# setter of System.Windows.Forms 4.8 (4.8.10001.0, the .NET Framework class Windows PowerShell 5.1 runs,
# read by reflection) checks DesignMode and whether the handle was created, then sends that message, as
# dotnet/winforms ToolTip.cs does. A tooltip control that is deactivated hides the tip it shows
# (TOOLTIPS_Activate in Wine's dlls/comctl32/tooltips.c, as read there; Windows' own control was not
# read). Whether it takes the tip off a real desktop is what the end-to-end case E2eOverlayIcon checks:
# it lets Fn go with a tip seen up and the pointer left still, and wants the tip gone within 1 s of the
# overlay being seen hidden, where a tip left to its own 5 s cannot be (the case fails as proving
# nothing when too much of the 5 s may have passed). That is a proof when the tip came up after the click
# with the pointer still, as in build #4, where the tip outlived the overlay before this change; when it
# came only after the case moved the pointer a pixel, it is evidence only. Its line says which. That case
# sees its tip after the overlay has been hidden before, so it also shows that the switch-on leaves the
# tooltips working. E2eOverlayLabel does not show it: by build #4's times its click already put the
# tip away. The switch-on is in the finally, so that however the off ends, the next time the overlay
# shows its tooltips work as before; Active leaves the registered texts as they are. The form is
# hidden first, so that no mouse message reaches the tooltip between the two.
function Hide-Overlay {
    param($Overlay)
    $Overlay.Form.Hide()
    try { $Overlay.ToolTip.Active = $false } finally { $Overlay.ToolTip.Active = $true }
}
