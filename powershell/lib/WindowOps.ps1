# Windows and their controls
# AHK window, control and message functions. Every $Window parameter takes an [IntPtr], an
# integer handle or a WinTitle string (see WinTitle.ps1). Waits pump messages (Wait-Pump).

function Resolve-WindowTarget {
    param($Window, [switch]$IncludeHidden)
    if ($Window -is [IntPtr]) { $h = $Window }
    elseif ($Window -is [int] -or $Window -is [long]) { $h = [IntPtr][long]$Window }
    else { $h = Find-Window ([string]$Window) -IncludeHidden:$IncludeHidden }
    if ($h -eq [IntPtr]::Zero -or -not [Macropad.WindowApi]::Exists($h)) { throw "Window not found: '$Window'" }
    $h
}

<#
.SYNOPSIS
Brings a window to the front and gives it the keyboard. It stands in for AutoHotkey's WinActivate and WinActivateBottom.
.DESCRIPTION
Restores the window first if it is minimized. Windows sometimes refuses to let a program take the front, so this uses the usual workarounds, tries once more after a short pause, and then reports whether the window is the active one.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER Bottom
With a WinTitle string that fits several windows, brings the lowest of them forward instead of the topmost. It has no effect when Window is a handle, because a handle names one window.
.OUTPUTS
True when the window is the active one afterwards, False when it is not.
.EXAMPLE
Switch-Window 'ahk_exe notepad.exe'
.EXAMPLE
Switch-Window 'ahk_exe chrome.exe' -Bottom
#>
function Switch-Window {
    param($Window, [switch]$Bottom)
    if ($Bottom -and $Window -is [string]) {
        $all = Find-Window $Window -All
        if ($all.Count -eq 0) { throw "Window not found: '$Window'" }
        $h = $all[-1]
    } else {
        $h = Resolve-WindowTarget $Window
    }
    if ([Macropad.Native]::ActivateWindow($h)) { return $true }
    Wait-Pump 20
    [Macropad.Native]::ActivateWindow($h)
}

<#
.SYNOPSIS
Waits for a window to appear, or to become active. It stands in for AutoHotkey's WinWait and WinWaitActive.
.DESCRIPTION
Looks about twenty times a second and returns as soon as a visible window fits the WinTitle (at once if one already does). The macropad stays responsive while it waits. Use it after starting a program, before doing anything to its window.
.PARAMETER WinTitle
A WinTitle string, which is text that describes a window, such as 'ahk_exe notepad.exe' or part of a title such as 'Untitled'; Find-Window lists every form. Leaving it out, or '', fits any visible window.
.PARAMETER Active
Wait until the window is the active one, the one that has the keyboard, and not only until it exists.
.PARAMETER TimeoutMs
How many milliseconds (thousandths of a second) to wait at most. 0 waits for as long as it takes.
.OUTPUTS
The window handle (the number Windows uses to name one window) of the window that was found, or 0 ([IntPtr]::Zero) when the time ran out. An if treats 0 as true, so compare with -ne [IntPtr]::Zero.
.EXAMPLE
Start-Program 'notepad'
$window = Wait-Window 'ahk_exe notepad.exe' -TimeoutMs 5000
if ($window -ne [IntPtr]::Zero) { Switch-Window $window }
.EXAMPLE
Wait-Window 'ahk_exe notepad.exe' -Active -TimeoutMs 5000
#>
function Wait-Window {
    param([string]$WinTitle, [switch]$Active, [int]$TimeoutMs = 0)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        if ($Active) { $h = Test-WindowActive $WinTitle } else { $h = Find-Window $WinTitle }
        if ($h -ne [IntPtr]::Zero) { return $h }
        if ($TimeoutMs -gt 0 -and $sw.ElapsedMilliseconds -ge $TimeoutMs) { return [IntPtr]::Zero }
        Wait-Pump 50
    }
}

<#
.SYNOPSIS
Waits for a window to close, or to stop being active. It stands in for AutoHotkey's WinWaitClose and WinWaitNotActive.
.DESCRIPTION
Looks about twenty times a second and returns as soon as no visible window fits the WinTitle (at once if none does). A window that is hidden counts as gone. The macropad stays responsive while it waits.
.PARAMETER WinTitle
A WinTitle string, which is text that describes a window, such as 'ahk_exe notepad.exe' or part of a title such as 'Untitled'; Find-Window lists every form. Leaving it out, or '', fits any visible window, so the wait goes on while any window exists.
.PARAMETER NotActive
Wait until the window is not the active one (the one that has the keyboard), instead of until it is gone.
.PARAMETER TimeoutMs
How many milliseconds (thousandths of a second) to wait at most. 0 waits for as long as it takes.
.OUTPUTS
True once the window is gone (or, with -NotActive, no longer active), False when the time ran out.
.EXAMPLE
Wait-WindowClose 'ahk_exe notepad.exe'
.EXAMPLE
Wait-WindowClose 'ahk_exe notepad.exe' -NotActive -TimeoutMs 10000
#>
function Wait-WindowClose {
    param([string]$WinTitle, [switch]$NotActive, [int]$TimeoutMs = 0)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        if ($NotActive) { $h = Test-WindowActive $WinTitle } else { $h = Find-Window $WinTitle }
        if ($h -eq [IntPtr]::Zero) { return $true }
        if ($TimeoutMs -gt 0 -and $sw.ElapsedMilliseconds -ge $TimeoutMs) { return $false }
        Wait-Pump 50
    }
}

<#
.SYNOPSIS
Asks a window to close, and can end its program. It stands in for AutoHotkey's WinClose and WinKill.
.DESCRIPTION
Posts the window the message that asks it to close (what clicking its close button leads to) and waits for it to go. The program may ask a question such as whether to save, or ignore the request, and the window then stays. With -Force, a window that is still there after the wait has its whole program ended, with all of its windows, and anything unsaved is lost; the call then waits up to one more second. The macropad's own process is never ended.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER Force
If the window is still there when the wait is over, end the program that owns it.
.PARAMETER TimeoutMs
How many milliseconds (thousandths of a second) to wait for the window to go after asking it to close.
.OUTPUTS
True when the window is gone at the end, False when it is still there.
.EXAMPLE
Close-Window 'ahk_exe notepad.exe'
.EXAMPLE
Close-Window 'ahk_exe notepad.exe' -Force
#>
function Close-Window {
    param($Window, [switch]$Force, [int]$TimeoutMs = 2000)
    $h = Resolve-WindowTarget $Window
    [void][Macropad.WindowApi]::Post($h, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ([Macropad.WindowApi]::Exists($h) -and $sw.ElapsedMilliseconds -lt $TimeoutMs) { Wait-Pump 20 }
    if ([Macropad.WindowApi]::Exists($h) -and $Force) {
        $windowPid = [Macropad.WindowApi]::ProcessId($h)
        if ($windowPid -ne $PID) {
            Stop-Process -Id $windowPid -Force -ErrorAction SilentlyContinue
            $sw.Restart()
            while ([Macropad.WindowApi]::Exists($h) -and $sw.ElapsedMilliseconds -lt 1000) { Wait-Pump 20 }
        }
    }
    -not [Macropad.WindowApi]::Exists($h)
}

<#
.SYNOPSIS
Minimizes, maximizes, restores, hides or shows a window. It stands in for AutoHotkey's WinMinimize, WinMaximize, WinRestore, WinHide and WinShow.
.DESCRIPTION
Asks Windows to change how the window is displayed. Hiding takes the window off the screen without closing it. A hidden window is not found by a WinTitle string, except by Show, which looks at hidden windows too; a window handle always works.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER State
What to do: Minimize (shrink it to the taskbar), Maximize (fill the screen), Restore (return a minimized or maximized window to its normal size), Hide (take it off the screen without closing it) or Show (display a hidden window again).
.OUTPUTS
Nothing. Windows does not say whether it did what was asked; Get-WindowState tells whether a window is minimized or maximized.
.EXAMPLE
Set-WindowState 'ahk_exe notepad.exe' Maximize
.EXAMPLE
Set-WindowState 'ahk_exe notepad.exe' Restore
#>
function Set-WindowState {
    param($Window, [Parameter(Mandatory)][ValidateSet('Minimize', 'Maximize', 'Restore', 'Hide', 'Show')][string]$State)
    $cmd = @{ Minimize = 6; Maximize = 3; Restore = 9; Hide = 0; Show = 5 }[$State]
    $h = Resolve-WindowTarget $Window -IncludeHidden:($State -eq 'Show')
    [void][Macropad.WindowApi]::ShowCmd($h, $cmd)
}

<#
.SYNOPSIS
Tells whether a window is minimized, maximized or normal. It stands in for AutoHotkey's WinGetMinMax.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.OUTPUTS
The word Minimized, Maximized or Normal.
.EXAMPLE
Get-WindowState 'ahk_exe notepad.exe'
.EXAMPLE
if ((Get-WindowState 'ahk_exe notepad.exe') -eq 'Minimized') { Set-WindowState 'ahk_exe notepad.exe' Restore }
#>
function Get-WindowState {
    param($Window)
    $h = Resolve-WindowTarget $Window
    if ([Macropad.WindowApi]::IsMinimized($h)) { return 'Minimized' }
    if ([Macropad.WindowApi]::IsMaximized($h)) { return 'Maximized' }
    'Normal'
}

<#
.SYNOPSIS
Moves a window, resizes it, or both. It stands in for AutoHotkey's WinMove.
.DESCRIPTION
Asks Windows to place the whole window, border and title bar included, at the given position and size. Positions are in pixels on the screen, counted from its top-left corner. A value that is left out keeps the window's current one. The window does not become active and keeps its place in front of or behind other windows.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER X
How far the window's left edge is from the left edge of the screen, in pixels. Leaving it out keeps the window's current position.
.PARAMETER Y
How far the window's top edge is from the top edge of the screen, in pixels. Leaving it out keeps the window's current position.
.PARAMETER Width
The window's new width in pixels. Leaving it out keeps the current width.
.PARAMETER Height
The window's new height in pixels. Leaving it out keeps the current height.
.OUTPUTS
Nothing. Windows does not say whether it moved the window; Get-WindowRect shows where the window is now.
.EXAMPLE
Move-Window 'ahk_exe notepad.exe' 100 100 800 600
.EXAMPLE
Move-Window 'ahk_exe notepad.exe' -X 0 -Y 0
#>
function Move-Window {
    param($Window, [Nullable[int]]$X, [Nullable[int]]$Y, [Nullable[int]]$Width, [Nullable[int]]$Height)
    $h = Resolve-WindowTarget $Window
    $r = [Macropad.WindowApi]::Rect($h)
    if ($null -eq $X) { $X = $r[0] }
    if ($null -eq $Y) { $Y = $r[1] }
    if ($null -eq $Width) { $Width = $r[2] }
    if ($null -eq $Height) { $Height = $r[3] }
    [void][Macropad.WindowApi]::Move($h, $X, $Y, $Width, $Height)
}

<#
.SYNOPSIS
Reads where a window is on the screen and how big it is. It stands in for AutoHotkey's WinGetPos, WinGetClientPos and ControlGetPos.
.DESCRIPTION
Positions are in pixels on the screen, counted from its top-left corner. By default the rectangle is the whole window with its border and title bar. With -Client it is only the area inside them, where the program draws its content. A control's handle from Find-Control works as the window too.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER Client
Give the area inside the border and title bar instead of the whole window. X and Y are then the screen position of that area's top-left corner.
.OUTPUTS
One object with X and Y (the position of the top-left corner) and Width and Height, all in pixels.
.EXAMPLE
Get-WindowRect 'ahk_exe notepad.exe'
.EXAMPLE
(Get-WindowRect 'ahk_exe notepad.exe' -Client).Width
#>
function Get-WindowRect {
    param($Window, [switch]$Client)
    $h = Resolve-WindowTarget $Window
    if ($Client) { $r = [Macropad.WindowApi]::ClientRect($h) } else { $r = [Macropad.WindowApi]::Rect($h) }
    [pscustomobject]@{ X = $r[0]; Y = $r[1]; Width = $r[2]; Height = $r[3] }
}

<#
.SYNOPSIS
Keeps a window on top of other windows, or stops doing so. It stands in for AutoHotkey's WinSetAlwaysOnTop.
.DESCRIPTION
A topmost window stays in front of every window that is not topmost, even while another window is active.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER On
$true keeps the window on top; $false lets other windows cover it again.
.OUTPUTS
Nothing. Windows does not say whether it did what was asked; Get-WindowStyle with -Ex shows the result (the bit 0x8 is set while a window is topmost).
.EXAMPLE
Set-WindowTopmost 'ahk_exe notepad.exe'
.EXAMPLE
Set-WindowTopmost 'ahk_exe notepad.exe' -On $false
#>
function Set-WindowTopmost {
    param($Window, [bool]$On = $true)
    [void][Macropad.WindowApi]::SetTopmost((Resolve-WindowTarget $Window), $On)
}

<#
.SYNOPSIS
Makes a window see-through, or puts it back to solid. It stands in for AutoHotkey's WinSetTransparent and WinSetTransColor.
.DESCRIPTION
Alpha makes the whole window partly see-through. TransColor makes every pixel of one colour see-through. Give either one or both. With neither (the two values -1), both effects are removed.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER Alpha
How solid the window is: 0 is invisible and 255 is solid; a larger number counts as 255. -1 sets no level.
.PARAMETER TransColor
A colour to make see-through, as 0xRRGGBB (the red, green and blue amounts, so 0xFF0000 is pure red). Every pixel of exactly that colour becomes see-through. -1 means no colour.
.OUTPUTS
Nothing. Windows does not say whether it did what was asked.
.EXAMPLE
Set-WindowTransparency 'ahk_exe notepad.exe' -Alpha 128
.EXAMPLE
Set-WindowTransparency 'ahk_exe notepad.exe'
#>
function Set-WindowTransparency {
    param($Window, [int]$Alpha = -1, [int]$TransColor = -1)
    $colorRef = -1
    if ($TransColor -ge 0) {
        $colorRef = (($TransColor -band 0xFF) -shl 16) -bor ($TransColor -band 0xFF00) -bor (($TransColor -shr 16) -band 0xFF)
    }
    [void][Macropad.WindowApi]::SetLayered((Resolve-WindowTarget $Window), $Alpha, $colorRef)
}

<#
.SYNOPSIS
Reads the style number of a window. It stands in for AutoHotkey's WinGetStyle and WinGetExStyle, and for ControlGetStyle and ControlGetExStyle.
.DESCRIPTION
A window's style is a number in which each bit switches one feature on or off; for example 0x10000 is the maximize button. The extended style, read with -Ex, is a second number for further features; for example 0x8 is set while the window is always on top. Pass a control's handle from Find-Control as the window to read a control's style.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER Ex
Read the extended style instead of the ordinary one.
.OUTPUTS
The style as a whole number. PowerShell shows it in decimal; '{0:X}' -f formats it as hex, and -band with a bit such as 0x8 tells whether that bit is set.
.EXAMPLE
Get-WindowStyle 'ahk_exe notepad.exe'
.EXAMPLE
((Get-WindowStyle 'ahk_exe notepad.exe' -Ex) -band 0x8) -ne 0
#>
function Get-WindowStyle {
    param($Window, [switch]$Ex)
    [Macropad.WindowApi]::GetStyle((Resolve-WindowTarget $Window), [bool]$Ex)
}

<#
.SYNOPSIS
Changes the style number of a window. It stands in for AutoHotkey's WinSetStyle and WinSetExStyle, and for ControlSetStyle and ControlSetExStyle.
.DESCRIPTION
A window's style is a number in which each bit switches one feature on or off; Get-WindowStyle explains it. For example, with -Ex, the bit 0x40000 gives the window a taskbar button. This writes a new style and then redraws the window's frame so a change to its borders shows. A wrong style can make a window hard to use, and Add and Remove change only the bits you name, so they are safer than Set. Pass a control's handle from Find-Control as the window to change a control's style.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER Value
The style bits to use, as a number such as 0x10000; what is done with them depends on Mode. Leaving it out gives 0, which with the mode Set clears every bit of the style.
.PARAMETER Mode
What to do with Value: Set replaces the whole style with Value, Add turns on the bits of Value and keeps the rest, Remove turns the bits of Value off and keeps the rest, and Toggle flips the bits of Value.
.PARAMETER Ex
Change the extended style instead of the ordinary one.
.OUTPUTS
Nothing. Windows does not say whether it accepted the change; Get-WindowStyle shows the style now.
.EXAMPLE
Set-WindowStyle 'ahk_exe notepad.exe' 0x10000 -Mode 'Remove'
.EXAMPLE
Set-WindowStyle 'ahk_exe notepad.exe' 0x40000 -Mode 'Add' -Ex
#>
function Set-WindowStyle {
    param($Window, [long]$Value, [ValidateSet('Set', 'Add', 'Remove', 'Toggle')][string]$Mode = 'Set', [switch]$Ex)
    $h = Resolve-WindowTarget $Window
    $current = [Macropad.WindowApi]::GetStyle($h, [bool]$Ex)
    $new = switch ($Mode) {
        'Set' { $Value }
        'Add' { $current -bor $Value }
        'Remove' { $current -band (-bnot $Value) }
        'Toggle' { $current -bxor $Value }
    }
    [void][Macropad.WindowApi]::SetStyle($h, [bool]$Ex, [long]$new)
    [Macropad.WindowApi]::RefreshFrame($h)
}

<#
.SYNOPSIS
Finds a control, such as a button or a text box, inside a window. It stands in for AutoHotkey's ControlGetHwnd.
.DESCRIPTION
A control is a part inside a window, such as a button, a text box or a list. This goes through the window's controls in the order Windows lists them and returns the first that fits. An error is raised when none does. The result is a window handle, because each control is a small window of its own. Pass it to Get-ControlText, Set-ControlText, Invoke-ControlClick or Send-ControlKeys. The examples need the Run dialog open: press Win+R first.
.PARAMETER Window
The window to act on: a window handle (the number Windows uses to name one window, as Find-Window returns it; a plain integer works too) or a WinTitle string. A WinTitle string is text that describes a window, such as 'ahk_exe notepad.exe' (the windows of that program), part of a title such as 'Untitled', or 'A' for the active window; Find-Window lists every form. An error is raised when no window is found. Leaving it out matches the first visible window, which is rarely the one you mean.
.PARAMETER Control
Which control: either its ClassNN, which is the control's class name followed by its number counting that class from 1 ('Edit1' is the first text box, 'Button2' the second button), or its text exactly as the window holds it, such as 'OK'. That text includes the & that marks a keyboard shortcut letter, so a button shown as Browse... may be '&Browse...'. Case counts.
.OUTPUTS
The window handle of the control (the number Windows uses to name one window), as the other control functions take it.
.EXAMPLE
Find-Control 'Run' 'Edit1'
.EXAMPLE
Find-Control 'Run' 'Cancel'
#>
function Find-Control {
    param($Window, [Parameter(Mandatory)][string]$Control)
    $parent = Resolve-WindowTarget $Window
    $seen = @{}
    foreach ($child in [Macropad.WindowApi]::Children($parent)) {
        $class = [Macropad.WindowApi]::ClassName($child)
        $seen[$class] = 1 + [int]$seen[$class]
        if (("$class$($seen[$class])" -ceq $Control) -or ([Macropad.WindowApi]::Title($child) -ceq $Control)) { return $child }
    }
    throw "Control not found: '$Control'"
}

<#
.SYNOPSIS
Reads the text of a control, such as what is typed in a text box. It stands in for AutoHotkey's ControlGetText.
.DESCRIPTION
Asks the control for its text and waits up to 5 seconds for each of the two answers it needs (the length of the text, then the text), so up to about 10 seconds in all; an error is raised when the program does not answer in time. The example needs the Run dialog open: press Win+R first.
.PARAMETER Control
The window handle of the control to read, as Find-Control returns it. A window handle is the number Windows uses to name one window, and each control is one. Leaving it out raises an error.
.OUTPUTS
The control's text, as one string.
.EXAMPLE
Get-ControlText (Find-Control 'Run' 'Edit1')
#>
function Get-ControlText {
    param([IntPtr]$Control)
    [Macropad.WindowApi]::GetText($Control, 5000)
}

<#
.SYNOPSIS
Replaces the text of a control, such as what is in a text box. It stands in for AutoHotkey's ControlSetText.
.DESCRIPTION
Gives the control a new text in place of its old one. To type keys into a control as if they were pressed, use Send-ControlKeys. The example needs the Run dialog open: press Win+R first.
.PARAMETER Control
The window handle of the control to change, as Find-Control returns it. A window handle is the number Windows uses to name one window, and each control is one. Leaving it out raises an error.
.PARAMETER Text
The new text. Leaving it out, or '', empties the control.
.OUTPUTS
Nothing. The control's answer is not used, so there is no sign of whether it took the text; Get-ControlText shows what it holds now.
.EXAMPLE
Set-ControlText (Find-Control 'Run' 'Edit1') 'notepad'
#>
function Set-ControlText {
    param([IntPtr]$Control, [AllowEmptyString()][string]$Text)
    [void][Macropad.WindowApi]::SetText($Control, $Text)
}

<#
.SYNOPSIS
Sends a window a numbered message. It stands in for AutoHotkey's SendMessage and PostMessage.
.DESCRIPTION
Windows talks to its windows with messages: a number saying what to do, plus up to two values that go with it. This sends one to a window or control. Without -Post it waits for the window's answer. With -Post it puts the message in the window's queue and carries on at once. Microsoft's list of window messages gives the numbers and what their values mean.
.PARAMETER Hwnd
The window handle of the window or control to send to: the number Windows uses to name one window, as Find-Window and Find-Control return it. Leaving it out raises an error.
.PARAMETER Msg
The message number, for example 0x10, which asks a window to close, or 0xE, which asks for the length of its text. Leaving it out sends message 0.
.PARAMETER WParam
The first value that goes with the message; what it means depends on the message. 0 when left out.
.PARAMETER LParam
The second value that goes with the message; what it means depends on the message. 0 when left out.
.PARAMETER Post
Do not wait for an answer: queue the message and return at once.
.PARAMETER TimeoutMs
Without -Post, how many milliseconds (thousandths of a second) to wait for the window to answer before an error is raised.
.OUTPUTS
Without -Post, the number the window answered with, whose meaning depends on the message; an error is raised when no answer comes in time. With -Post, 1 when the message was queued and 0 when it was not.
.EXAMPLE
$window = Find-Window 'ahk_exe notepad.exe'
if ($window -ne [IntPtr]::Zero) { Send-WindowMessage $window 0x10 -Post }
.EXAMPLE
$window = Find-Window 'ahk_exe notepad.exe'
if ($window -ne [IntPtr]::Zero) { Send-WindowMessage $window 0xE }
#>
function Send-WindowMessage {
    param([IntPtr]$Hwnd, [uint32]$Msg, [long]$WParam = 0, [long]$LParam = 0, [switch]$Post, [int]$TimeoutMs = 5000)
    if ($Post) { return [long][Macropad.WindowApi]::Post($Hwnd, $Msg, [IntPtr]$WParam, [IntPtr]$LParam) }
    [Macropad.WindowApi]::Send($Hwnd, $Msg, [IntPtr]$WParam, [IntPtr]$LParam, $TimeoutMs)
}

<#
.SYNOPSIS
Clicks a control without moving the mouse. It stands in for AutoHotkey's ControlClick.
.DESCRIPTION
Posts a button-down and a button-up message straight to the control, at a point inside it: its middle unless X and Y say otherwise. The mouse pointer does not move. To click at a point on the screen with the real mouse, use Send-Click. The examples need the Run dialog open: press Win+R first.
.PARAMETER Control
The window handle of the control to click, as Find-Control returns it. A window handle is the number Windows uses to name one window, and each control is one. Leaving it out raises an error.
.PARAMETER Button
Which button to click: Left, Right or Middle.
.PARAMETER X
How far from the control's left edge to click, in pixels. A negative value, which is what -1 is, means the middle.
.PARAMETER Y
How far from the control's top edge to click, in pixels. A negative value, which is what -1 is, means the middle.
.OUTPUTS
Nothing. The messages are queued, and there is no sign of whether the control reacted.
.EXAMPLE
Invoke-ControlClick (Find-Control 'Run' 'Cancel')
.EXAMPLE
Invoke-ControlClick (Find-Control 'Run' 'Edit1') -X 10 -Y 5
#>
function Invoke-ControlClick {
    param([IntPtr]$Control, [ValidateSet('Left', 'Right', 'Middle')][string]$Button = 'Left', [int]$X = -1, [int]$Y = -1)
    $r = [Macropad.WindowApi]::ClientRect($Control)
    if ($X -lt 0) { $X = [int][Math]::Floor($r[2] / 2) }
    if ($Y -lt 0) { $Y = [int][Math]::Floor($r[3] / 2) }
    $msgs = @{ Left = @(0x201, 0x202, 0x1); Right = @(0x204, 0x205, 0x2); Middle = @(0x207, 0x208, 0x10) }[$Button]
    $lParam = [IntPtr][long](($Y -shl 16) -bor ($X -band 0xFFFF))
    [void][Macropad.WindowApi]::Post($Control, $msgs[0], [IntPtr]$msgs[2], $lParam)
    [void][Macropad.WindowApi]::Post($Control, $msgs[1], [IntPtr]::Zero, $lParam)
}

<#
.SYNOPSIS
Types keys into a control without using the keyboard. It stands in for AutoHotkey's ControlSend and ControlSendText.
.DESCRIPTION
Posts the keys straight to the control, so the real keyboard and the active window are not involved. Characters are posted as characters and keys such as Enter as key presses. The modifier keys (^ ! + #) are posted as key presses of their own and do not change what the control sees as held down, so shortcuts such as '^a' may not act as a real keypress would. The example needs the Run dialog open: press Win+R first.
.PARAMETER Control
The window handle of the control to type into, as Find-Control returns it. A window handle is the number Windows uses to name one window, and each control is one. Leaving it out raises an error.
.PARAMETER Keys
What to type, in AutoHotkey's Send syntax: ordinary characters are typed as they are, and a key name goes in braces, such as '{Enter}', '{Tab}' or '{Left 3}' (a number repeats the key). The Keys note of Send-Ahk gives the whole syntax. An unknown key name raises an error.
.OUTPUTS
Nothing. The messages are queued, and there is no sign of whether the control used them.
.EXAMPLE
Send-ControlKeys (Find-Control 'Run' 'Edit1') 'notepad'
#>
function Send-ControlKeys {
    param([IntPtr]$Control, [Parameter(Mandatory)][AllowEmptyString()][string]$Keys)
    foreach ($ev in @((ConvertFrom-AhkSend $Keys).Events)) {
        if ($ev.Char) {
            if ($ev.Up) { continue }
            foreach ($c in [char]::ConvertFromUtf32([int]$ev.Char).ToCharArray()) {
                [void][Macropad.WindowApi]::Post($Control, 0x102, [IntPtr][int]$c, [IntPtr]1)
            }
        } else {
            $scan = [long][Macropad.Native]::MapVirtualKey([uint32]$ev.Vk, 0)
            $lParam = 1L -bor ($scan -shl 16)
            $msg = 0x100
            if ($ev.Up) { $lParam = $lParam -bor 0xC0000000L; $msg = 0x101 }
            [void][Macropad.WindowApi]::Post($Control, $msg, [IntPtr][long]$ev.Vk, [IntPtr]$lParam)
        }
    }
}
