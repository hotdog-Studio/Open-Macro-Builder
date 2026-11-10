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

# AHK WinActivate / WinActivateBottom.
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

# AHK WinWait / WinWaitActive: the window, or [IntPtr]::Zero after $TimeoutMs (0 waits forever).
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

# AHK WinWaitClose / WinWaitNotActive: $true once no match exists (or none is active).
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

# AHK WinClose / WinKill: posts WM_CLOSE, waits for the window to go, and with -Force ends its
# process (never this one). Returns whether the window is gone.
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

# AHK WinMinimize, WinMaximize, WinRestore, WinHide, WinShow.
function Set-WindowState {
    param($Window, [Parameter(Mandatory)][ValidateSet('Minimize', 'Maximize', 'Restore', 'Hide', 'Show')][string]$State)
    $cmd = @{ Minimize = 6; Maximize = 3; Restore = 9; Hide = 0; Show = 5 }[$State]
    $h = Resolve-WindowTarget $Window -IncludeHidden:($State -eq 'Show')
    [void][Macropad.WindowApi]::ShowCmd($h, $cmd)
}

# AHK WinGetMinMax.
function Get-WindowState {
    param($Window)
    $h = Resolve-WindowTarget $Window
    if ([Macropad.WindowApi]::IsMinimized($h)) { return 'Minimized' }
    if ([Macropad.WindowApi]::IsMaximized($h)) { return 'Maximized' }
    'Normal'
}

# AHK WinMove: omitted values keep the current ones.
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

# AHK WinGetPos / WinGetClientPos / ControlGetPos, in screen coordinates.
function Get-WindowRect {
    param($Window, [switch]$Client)
    $h = Resolve-WindowTarget $Window
    if ($Client) { $r = [Macropad.WindowApi]::ClientRect($h) } else { $r = [Macropad.WindowApi]::Rect($h) }
    [pscustomobject]@{ X = $r[0]; Y = $r[1]; Width = $r[2]; Height = $r[3] }
}

# AHK WinSetAlwaysOnTop.
function Set-WindowTopmost {
    param($Window, [bool]$On = $true)
    [void][Macropad.WindowApi]::SetTopmost((Resolve-WindowTarget $Window), $On)
}

# AHK WinSetTransparent / WinSetTransColor. $TransColor is 0xRRGGBB; both -1 turns it off.
function Set-WindowTransparency {
    param($Window, [int]$Alpha = -1, [int]$TransColor = -1)
    $colorRef = -1
    if ($TransColor -ge 0) {
        $colorRef = (($TransColor -band 0xFF) -shl 16) -bor ($TransColor -band 0xFF00) -bor (($TransColor -shr 16) -band 0xFF)
    }
    [void][Macropad.WindowApi]::SetLayered((Resolve-WindowTarget $Window), $Alpha, $colorRef)
}

# AHK WinGetStyle / WinGetExStyle (and the Control versions via a control handle).
function Get-WindowStyle {
    param($Window, [switch]$Ex)
    [Macropad.WindowApi]::GetStyle((Resolve-WindowTarget $Window), [bool]$Ex)
}

# AHK WinSetStyle / WinSetExStyle (and the Control versions via a control handle).
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

# AHK ControlGetHwnd: by ClassNN (class name + 1-based count of that class so far) or exact text.
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

# AHK ControlGetText / ControlSetText.
function Get-ControlText {
    param([IntPtr]$Control)
    [Macropad.WindowApi]::GetText($Control, 5000)
}

function Set-ControlText {
    param([IntPtr]$Control, [AllowEmptyString()][string]$Text)
    [void][Macropad.WindowApi]::SetText($Control, $Text)
}

# AHK SendMessage / PostMessage.
function Send-WindowMessage {
    param([IntPtr]$Hwnd, [uint32]$Msg, [long]$WParam = 0, [long]$LParam = 0, [switch]$Post, [int]$TimeoutMs = 5000)
    if ($Post) { return [long][Macropad.WindowApi]::Post($Hwnd, $Msg, [IntPtr]$WParam, [IntPtr]$LParam) }
    [Macropad.WindowApi]::Send($Hwnd, $Msg, [IntPtr]$WParam, [IntPtr]$LParam, $TimeoutMs)
}

# AHK ControlClick: posts button down then up at client (X, Y), or the control's centre.
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

# AHK ControlSend: posts the keys to the control. Characters go as WM_CHAR; keys as
# WM_KEYDOWN/WM_KEYUP. Modifiers are posted like any key and do not change the target's
# modifier state, as with AHK's ControlSend.
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
