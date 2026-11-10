# AHK screen, mouse and tooltip functions. Coordinates are screen coordinates throughout
# (AHK CoordMode Screen); ConvertTo-ScreenPoint converts client coordinates.

# AHK PixelGetColor: 0xRRGGBB.
function Get-PixelColor {
    param([int]$X, [int]$Y)
    $bmp = [Macropad.ScreenApi]::Capture($X, $Y, 1, 1)
    try { $bmp.GetPixel(0, 0).ToArgb() -band 0xFFFFFF } finally { $bmp.Dispose() }
}

# AHK PixelSearch over the inclusive rectangle: @{ X; Y } or $null.
function Find-Pixel {
    param([int]$X1, [int]$Y1, [int]$X2, [int]$Y2, [int]$Color, [int]$Variation = 0)
    $bmp = [Macropad.ScreenApi]::Capture($X1, $Y1, $X2 - $X1 + 1, $Y2 - $Y1 + 1)
    try {
        $hit = [Macropad.ScreenApi]::FindPixel($bmp, $Color, $Variation)
        if ($null -eq $hit) { return $null }
        [pscustomobject]@{ X = $X1 + $hit[0]; Y = $Y1 + $hit[1] }
    } finally { $bmp.Dispose() }
}

# AHK ImageSearch over the inclusive rectangle: @{ X; Y } of the image's top-left, or $null.
function Find-Image {
    param([int]$X1, [int]$Y1, [int]$X2, [int]$Y2, [string]$Path, [int]$Variation = 0, [int]$TransColor = -1)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Image not found: $Path" }
    # Copy the file into memory so the file is not left locked.
    $file = [System.Drawing.Bitmap]::FromFile($Path)
    try { $needle = New-Object System.Drawing.Bitmap $file } finally { $file.Dispose() }
    $hay = [Macropad.ScreenApi]::Capture($X1, $Y1, $X2 - $X1 + 1, $Y2 - $Y1 + 1)
    try {
        $hit = [Macropad.ScreenApi]::FindImage($hay, $needle, $Variation, $TransColor)
        if ($null -eq $hit) { return $null }
        [pscustomobject]@{ X = $X1 + $hit[0]; Y = $Y1 + $hit[1] }
    } finally { $hay.Dispose(); $needle.Dispose() }
}

# AHK MouseMove.
function Move-Mouse {
    param([int]$X, [int]$Y)
    [void][Macropad.Native]::SetCursorPos($X, $Y)
}

# AHK MouseGetPos: the cursor, the top-level window under it and the control under it
# ([IntPtr]::Zero when that is the window itself).
function Get-MousePosition {
    $p = [Macropad.ScreenApi]::CursorPos()
    $at = [Macropad.ScreenApi]::WindowAt($p[0], $p[1])
    $window = [IntPtr]::Zero
    if ($at -ne [IntPtr]::Zero) { $window = [Macropad.ScreenApi]::Root($at) }
    $control = [IntPtr]::Zero
    if ($at -ne $window) { $control = $at }
    [pscustomobject]@{ X = $p[0]; Y = $p[1]; Window = $window; Control = $control }
}

# Client coordinates of a window to screen coordinates (AHK CoordMode Client).
function ConvertTo-ScreenPoint {
    param([IntPtr]$Hwnd, [int]$X, [int]$Y)
    $p = [Macropad.ScreenApi]::ClientToScreen($Hwnd, $X, $Y)
    [pscustomobject]@{ X = $p[0]; Y = $p[1] }
}

# The reusable tooltip window for an id (found by name, so no script state is needed).
function Get-ToolTipForm {
    param([ValidateRange(1, 20)][int]$Id = 1)
    @([System.Windows.Forms.Application]::OpenForms) | Where-Object { $_.Name -eq "MacropadToolTip$Id" } | Select-Object -First 1
}

# AHK ToolTip: a small window that never takes focus, at (X, Y) or just below-right of the cursor.
function Show-ToolTip {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text, [int]$X = -1, [int]$Y = -1, [ValidateRange(1, 20)][int]$Id = 1)
    $form = Get-ToolTipForm $Id
    if ($null -eq $form) {
        $form = [Macropad.OverlayForm]::new()
        $form.Name = "MacropadToolTip$Id"
        $form.FormBorderStyle = 'None'
        $form.TopMost = $true
        $form.ShowInTaskbar = $false
        $form.StartPosition = 'Manual'
        $form.AutoSize = $true
        $form.AutoSizeMode = 'GrowAndShrink'
        $label = New-Object System.Windows.Forms.Label
        $label.AutoSize = $true
        $label.BorderStyle = 'FixedSingle'
        $label.BackColor = [System.Drawing.SystemColors]::Info
        $label.ForeColor = [System.Drawing.SystemColors]::InfoText
        $label.Padding = New-Object System.Windows.Forms.Padding(3)
        $label.UseMnemonic = $false
        $form.Controls.Add($label)
    }
    $form.Controls[0].Text = $Text
    if ($X -lt 0 -or $Y -lt 0) {
        $p = [Macropad.ScreenApi]::CursorPos()
        if ($X -lt 0) { $X = $p[0] + 16 }
        if ($Y -lt 0) { $Y = $p[1] + 16 }
    }
    $form.Location = New-Object System.Drawing.Point($X, $Y)
    if (-not $form.Visible) { $form.Show() }
    $form.Location = New-Object System.Drawing.Point($X, $Y)
}

function Hide-ToolTip {
    param([ValidateRange(1, 20)][int]$Id = 1)
    $form = Get-ToolTipForm $Id
    if ($null -ne $form) { $form.Hide() }
}
