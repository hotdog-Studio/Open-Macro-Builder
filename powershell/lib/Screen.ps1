# Mouse, screen and tooltips
# AHK screen, mouse and tooltip functions. Coordinates are screen coordinates throughout
# (AHK CoordMode Screen); ConvertTo-ScreenPoint converts client coordinates.

<#
.SYNOPSIS
Reads the colour of one pixel on the screen. It stands in for AutoHotkey's PixelGetColor.
.DESCRIPTION
Looks at what is on the screen at that point. Positions are screen coordinates: pixels counted from the top-left corner of the screen.
.PARAMETER X
How far from the left edge of the screen, in pixels. Leaving it out means 0.
.PARAMETER Y
How far from the top edge of the screen, in pixels. Leaving it out means 0.
.OUTPUTS
The colour as one number, 0xRRGGBB: the red, green and blue amounts (0 to 255 each) side by side, so 0xFF0000 is pure red. PowerShell shows it in decimal; '{0:X6}' -f formats it as hex.
.EXAMPLE
Get-PixelColor 500 300
.EXAMPLE
'{0:X6}' -f (Get-PixelColor 500 300)
#>
function Get-PixelColor {
    param([int]$X, [int]$Y)
    $bmp = [Macropad.ScreenApi]::Capture($X, $Y, 1, 1)
    try { $bmp.GetPixel(0, 0).ToArgb() -band 0xFFFFFF } finally { $bmp.Dispose() }
}

<#
.SYNOPSIS
Looks for a colour inside a rectangle of the screen. It stands in for AutoHotkey's PixelSearch.
.DESCRIPTION
Looks at what is on the screen inside the rectangle, row by row from its top-left corner, and gives the first pixel whose colour is close enough to Color. The corners belong to the rectangle. Positions are screen coordinates: pixels counted from the top-left corner of the screen. X2 must not be smaller than X1, nor Y2 smaller than Y1.
.PARAMETER X1
The left edge of the rectangle, in pixels from the left edge of the screen. Leaving it out means 0, the left edge of the screen.
.PARAMETER Y1
The top edge of the rectangle, in pixels from the top edge of the screen. Leaving it out means 0, the top edge of the screen.
.PARAMETER X2
The right edge of the rectangle, in pixels from the left edge of the screen. Leaving it out means 0, which is not a usable rectangle unless X1 is 0 too (then it is one pixel wide).
.PARAMETER Y2
The bottom edge of the rectangle, in pixels from the top edge of the screen. Leaving it out means 0, which is not a usable rectangle unless Y1 is 0 too (then it is one pixel high).
.PARAMETER Color
The colour to look for, as 0xRRGGBB (the red, green and blue amounts, so 0xFF0000 is pure red). Leaving it out looks for black.
.PARAMETER Variation
How far each of red, green and blue may differ from Color, from 0 to 255. 0 needs an exact match.
.OUTPUTS
An object with X and Y, the screen position of the first pixel found, or $null when no pixel fits.
.EXAMPLE
$hit = Find-Pixel 0 0 800 600 0xFF0000
if ($hit) { Move-Mouse $hit.X $hit.Y }
.EXAMPLE
Find-Pixel 0 0 800 600 0xFF0000 -Variation 10
#>
function Find-Pixel {
    param([int]$X1, [int]$Y1, [int]$X2, [int]$Y2, [int]$Color, [int]$Variation = 0)
    $bmp = [Macropad.ScreenApi]::Capture($X1, $Y1, $X2 - $X1 + 1, $Y2 - $Y1 + 1)
    try {
        $hit = [Macropad.ScreenApi]::FindPixel($bmp, $Color, $Variation)
        if ($null -eq $hit) { return $null }
        [pscustomobject]@{ X = $X1 + $hit[0]; Y = $Y1 + $hit[1] }
    } finally { $bmp.Dispose() }
}

<#
.SYNOPSIS
Looks for a picture inside a rectangle of the screen. It stands in for AutoHotkey's ImageSearch.
.DESCRIPTION
Looks at what is on the screen inside the rectangle and searches it for the picture from an image file, row by row from the top-left corner, and gives the first place where every pixel fits. A large rectangle takes longer. The corners belong to the rectangle. Positions are screen coordinates: pixels counted from the top-left corner of the screen. X2 must not be smaller than X1, nor Y2 smaller than Y1.
.PARAMETER X1
The left edge of the rectangle, in pixels from the left edge of the screen. Leaving it out means 0, the left edge of the screen.
.PARAMETER Y1
The top edge of the rectangle, in pixels from the top edge of the screen. Leaving it out means 0, the top edge of the screen.
.PARAMETER X2
The right edge of the rectangle, in pixels from the left edge of the screen. Leaving it out means 0, which is not a usable rectangle unless X1 is 0 too (then it is one pixel wide).
.PARAMETER Y2
The bottom edge of the rectangle, in pixels from the top edge of the screen. Leaving it out means 0, which is not a usable rectangle unless Y1 is 0 too (then it is one pixel high).
.PARAMETER Path
The full path of the image file to look for, such as a PNG, BMP or JPEG file. An error is raised when there is no file at that path. Leaving it out raises an error too. The path in the example is only a placeholder: use the path of an image file of your own.
.PARAMETER Variation
How far each of red, green and blue may differ between the screen and the picture, from 0 to 255. 0 needs an exact match.
.PARAMETER TransColor
A colour in the picture, as 0xRRGGBB, that matches anything on the screen, so a picture can have parts that do not count. -1 means no such colour.
.OUTPUTS
An object with X and Y, the screen position of the picture's top-left corner where it was found, or $null when it was not found (which includes a picture larger than the rectangle).
.EXAMPLE
$hit = Find-Image 0 0 1000 800 'C:\Users\Public\Pictures\button.png'
if ($hit) { Send-Click $hit.X $hit.Y }
#>
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

<#
.SYNOPSIS
Moves the mouse pointer to a point on the screen. It stands in for AutoHotkey's MouseMove.
.DESCRIPTION
Puts the pointer at the point at once and does not click. Positions are screen coordinates: pixels counted from the top-left corner of the screen.
.PARAMETER X
How far from the left edge of the screen, in pixels. Leaving it out means 0.
.PARAMETER Y
How far from the top edge of the screen, in pixels. Leaving it out means 0.
.OUTPUTS
Nothing. Windows does not say whether it moved the pointer; Get-MousePosition shows where it is.
.EXAMPLE
Move-Mouse 500 300
#>
function Move-Mouse {
    param([int]$X, [int]$Y)
    [void][Macropad.Native]::SetCursorPos($X, $Y)
}

<#
.SYNOPSIS
Tells where the mouse pointer is and what is under it. It stands in for AutoHotkey's MouseGetPos.
.DESCRIPTION
Positions are screen coordinates: pixels counted from the top-left corner of the screen. The two handles are window handles, the numbers Windows uses to name one window; Get-WindowInfo describes a window from its handle.
.OUTPUTS
One object with X and Y (the pointer's position), Window (the handle of the top-level window under the pointer, 0 when there is none) and Control (the handle of the control under the pointer, such as a button or a text box, or 0 when the pointer is over the window itself). 0 is [IntPtr]::Zero, which an if treats as true, so compare with -ne.
.EXAMPLE
Get-MousePosition
.EXAMPLE
$mouse = Get-MousePosition
Get-WindowInfo $mouse.Window
#>
function Get-MousePosition {
    $p = [Macropad.ScreenApi]::CursorPos()
    $at = [Macropad.ScreenApi]::WindowAt($p[0], $p[1])
    $window = [IntPtr]::Zero
    if ($at -ne [IntPtr]::Zero) { $window = [Macropad.ScreenApi]::Root($at) }
    $control = [IntPtr]::Zero
    if ($at -ne $window) { $control = $at }
    [pscustomobject]@{ X = $p[0]; Y = $p[1]; Window = $window; Control = $control }
}

<#
.SYNOPSIS
Turns a point inside a window into a point on the screen. It stands in for AutoHotkey's CoordMode.
.DESCRIPTION
Every position in these functions is a screen coordinate. If you know where something is inside a window, measured from the top-left corner of the area inside its border and title bar, this gives the matching screen position, which Send-Click, Move-Mouse and the others take.
.PARAMETER Hwnd
The window handle of the window the point is in: the number Windows uses to name one window, as Find-Window returns it. Leaving it out raises an error.
.PARAMETER X
How far from the left edge of the area inside the window, in pixels. Leaving it out means 0, the area's left edge.
.PARAMETER Y
How far from the top edge of the area inside the window, in pixels. Leaving it out means 0, the area's top edge.
.OUTPUTS
One object with X and Y, the point's position on the screen in pixels.
.EXAMPLE
$window = Find-Window 'ahk_exe notepad.exe'
if ($window -ne [IntPtr]::Zero) { $point = ConvertTo-ScreenPoint $window 20 20; Send-Click $point.X $point.Y }
#>
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

<#
.SYNOPSIS
Shows a small note next to the mouse pointer or at a point on the screen. It stands in for AutoHotkey's ToolTip.
.DESCRIPTION
The note is a small window in the system's tooltip colours that stays on top of other windows and never takes the keyboard focus. It is placed once and does not follow the pointer, and it stays until Hide-ToolTip is called. Calling Show-ToolTip again with the same Id changes that note's text and position instead of adding another. Up to 20 notes can show at once, told apart by Id. Positions are screen coordinates: pixels counted from the top-left corner of the screen.
.PARAMETER Text
What the note says.
.PARAMETER X
How far from the left edge of the screen, in pixels. Any negative number (-1 is usual), or leaving it out, puts the note 16 pixels to the right of the mouse pointer.
.PARAMETER Y
How far from the top edge of the screen, in pixels. Any negative number (-1 is usual), or leaving it out, puts the note 16 pixels below the mouse pointer.
.PARAMETER Id
Which note, from 1 to 20. Use different ids to show several notes at once.
.OUTPUTS
Nothing.
.EXAMPLE
Show-ToolTip 'Saved'
Wait-Pump 2000
Hide-ToolTip
.EXAMPLE
Show-ToolTip 'Done' -X 100 -Y 100 -Id 2
#>
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

<#
.SYNOPSIS
Hides a note shown by Show-ToolTip. It stands in for AutoHotkey's ToolTip called with no text.
.DESCRIPTION
Hides the note with that Id. When there is no such note, nothing happens.
.PARAMETER Id
Which note to hide, from 1 to 20: the Id given to Show-ToolTip.
.OUTPUTS
Nothing.
.EXAMPLE
Hide-ToolTip
.EXAMPLE
Hide-ToolTip -Id 2
#>
function Hide-ToolTip {
    param([ValidateRange(1, 20)][int]$Id = 1)
    $form = Get-ToolTipForm $Id
    if ($null -ne $form) { $form.Hide() }
}
