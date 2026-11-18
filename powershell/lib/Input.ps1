# Keys and mouse clicks
# Key and mouse input: key-name table, chord parsing and sending, key state.
# A chord is key names joined by '+': 'Ctrl+Shift+t' holds Ctrl and Shift, taps t,
# then releases Shift and Ctrl.

$script:VirtualKeys = @{
    LWin = 0x5B; RWin = 0x5C; Win = 0x5B
    Ctrl = 0x11; LCtrl = 0xA2; RCtrl = 0xA3
    Alt = 0x12; LAlt = 0xA4; RAlt = 0xA5
    Shift = 0x10; LShift = 0xA0; RShift = 0xA1
    Left = 0x25; Up = 0x26; Right = 0x27; Down = 0x28
    Home = 0x24; End = 0x23; PgUp = 0x21; PgDn = 0x22; Insert = 0x2D; Delete = 0x2E
    Tab = 0x09; Enter = 0x0D; Escape = 0x1B; Space = 0x20; Backspace = 0x08
    PrintScreen = 0x2C; ScrollLock = 0x91; CapsLock = 0x14; NumLock = 0x90; Pause = 0x13
    Media_Play_Pause = 0xB3; Media_Next = 0xB0; Media_Prev = 0xB1; Media_Stop = 0xB2
    Volume_Up = 0xAF; Volume_Down = 0xAE; Volume_Mute = 0xAD
    LButton = 0x01; RButton = 0x02; MButton = 0x04; XButton1 = 0x05; XButton2 = 0x06
    '\' = 0xDC; "'" = 0xDE; ';' = 0xBA; '=' = 0xBB; ',' = 0xBC; '-' = 0xBD; '.' = 0xBE; '/' = 0xBF
    '`' = 0xC0; '[' = 0xDB; ']' = 0xDD
}
foreach ($n in 1..24) { $script:VirtualKeys["F$n"] = 0x6F + $n }
foreach ($n in 0..25) { $script:VirtualKeys[[string][char](0x61 + $n)] = 0x41 + $n }
foreach ($n in 0..9) { $script:VirtualKeys["$n"] = 0x30 + $n }

$script:ExtendedKeys = @(0x25, 0x26, 0x27, 0x28, 0x24, 0x23, 0x21, 0x22, 0x2D, 0x2E, 0xA3, 0xA5, 0x5B, 0x5C, 0x2C, 0x90) + (0xA6..0xB7)

# The symbol names. The table above gives the key codes of a US keyboard; another layout often gives a
# character another code (on en-GB ' is vk C0, the US code for `, and ` is vk DF), so these names
# press the key that types the character on the layout in use, and the table only when it has none.
$script:SymbolKeyNames = @('\', "'", ';', '=', ',', '-', '.', '/', '`', '[', ']')

# Seams for tests around the three Windows calls: the active window, a window's keyboard layout, and
# VkKeyScanEx (low byte the virtual key, high byte the shift state, -1 when no key types the character).
function Get-ForegroundWindowHandle { [Macropad.Native]::GetForegroundWindow() }
function Get-WindowKeyboardLayout { param([IntPtr]$Hwnd) [Macropad.Native]::WindowLayout($Hwnd) }
function Get-LayoutKeyScan { param([char]$Char, [IntPtr]$Layout) [int][Macropad.Native]::KeyScan($Char, $Layout) }

# The keyboard layout of the active window, the one that turns keys into characters there; 0 when it
# cannot be read.
function Get-ForegroundKeyboardLayout {
    try { [IntPtr](Get-WindowKeyboardLayout (Get-ForegroundWindowHandle)) } catch { [IntPtr]::Zero }
}

# The virtual key that types Char on its own on the keyboard layout of the active window, or -1 when
# that layout has no such key, needs Shift or AltGr (or another modifier) for it, or cannot be read.
function Get-LayoutVirtualKey {
    param([Parameter(Mandatory)][char]$Char)
    try { $scan = Get-LayoutKeyScan $Char (Get-ForegroundKeyboardLayout) } catch { return -1 }
    if ($scan -eq -1 -or ($scan -band 0xFF00) -ne 0) { return -1 }
    $vk = $scan -band 0xFF
    if ($vk -eq 0 -or $vk -eq 0xFF) { return -1 }
    $vk
}

function Get-VirtualKey {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Name)
    if (-not $script:VirtualKeys.ContainsKey($Name)) { throw "Unknown key name '$Name'" }
    if ($script:SymbolKeyNames -contains $Name) {
        # Only a key that types the character on its own: one that needs Shift or AltGr for it would,
        # pressed alone, be a digit or a letter (de-DE = is Shift+0), so the table's key is kept then.
        $vk = Get-LayoutVirtualKey $Name[0]
        if ($vk -gt 0) { return $vk }
    }
    [int]$script:VirtualKeys[$Name]
}

function Test-ExtendedKey {
    param([Parameter(Mandatory)][int]$Vk)
    $script:ExtendedKeys -contains $Vk
}

function ConvertTo-KeyEvent {
    param([Parameter(Mandatory)][string]$Chord)
    # Resolve every name first so an unknown name throws before anything is sent.
    $keys = @(foreach ($name in ($Chord -split '\+')) {
        $trimmed = $name.Trim()
        [pscustomobject]@{ Name = $trimmed; Vk = Get-VirtualKey $trimmed }
    })
    $held = @()
    if ($keys.Count -gt 1) { $held = $keys[0..($keys.Count - 2)] }
    $last = $keys[-1]

    $events = [System.Collections.Generic.List[object]]::new()
    foreach ($k in $held) { $events.Add([pscustomobject]@{ Name = $k.Name; Vk = $k.Vk; Up = $false }) }
    $events.Add([pscustomobject]@{ Name = $last.Name; Vk = $last.Vk; Up = $false })
    $events.Add([pscustomobject]@{ Name = $last.Name; Vk = $last.Vk; Up = $true })
    for ($i = $held.Count - 1; $i -ge 0; $i--) {
        $events.Add([pscustomobject]@{ Name = $held[$i].Name; Vk = $held[$i].Vk; Up = $true })
    }
    $events.ToArray()
}

function Send-KeyEvent {
    param([Parameter(Mandatory)]$Event)
    # Tagged SendInput (lib/cs/Inject.cs), so the macropad's own hooks ignore it.
    [Macropad.Inject]::Key([int]$Event.Vk, [bool]$Event.Up, (Test-ExtendedKey $Event.Vk))
}

<#
.SYNOPSIS
Presses a key combination such as Ctrl+Shift+T.
.DESCRIPTION
Holds every key but the last, taps the last, then lets the held keys go in reverse order. One key name alone works too. Every name is checked before anything is pressed, so an unknown name raises an error and sends nothing.
.PARAMETER Chord
Key names joined by '+', for example 'Ctrl+Shift+t' or 'LWin+Left'. Case does not matter, and Shift is pressed only when you name it. The names are: Ctrl, LCtrl, RCtrl, Alt, LAlt, RAlt, Shift, LShift, RShift, Win, LWin, RWin; Left, Up, Right, Down, Home, End, PgUp, PgDn; Insert, Delete, Tab, Enter, Escape, Space, Backspace; PrintScreen, ScrollLock, CapsLock, NumLock, Pause; Media_Play_Pause, Media_Next, Media_Prev, Media_Stop, Volume_Up, Volume_Down, Volume_Mute; the letters a to z, the digits 0 to 9 and F1 to F24; and the symbol keys \ ' ; = , - . / ` [ ]. A symbol names the key that types that character, without Shift or AltGr, on the keyboard layout of the active window, so on a UK keyboard ' is the key marked ' and @, and ` the key left of 1. When the layout has no such key, or types the character only with Shift or AltGr (as a German keyboard types =), the key a US keyboard has for it is pressed. The plus key has no name, because '+' separates the names.
.EXAMPLE
Send-Chord 'LWin+Shift+Right'
.EXAMPLE
Send-Chord 'Ctrl+Shift+t'
#>
function Send-Chord {
    param([Parameter(Mandatory)][string]$Chord)
    foreach ($e in (ConvertTo-KeyEvent $Chord)) { Send-KeyEvent $e }
}

<#
.SYNOPSIS
Presses and releases one key.
.DESCRIPTION
The same as Send-Chord with a single key name.
.PARAMETER Name
The name of one key, such as 'Enter', 'F5' or 'Media_Play_Pause'. The Chord note of Send-Chord lists the names.
.EXAMPLE
Send-Key 'Enter'
.EXAMPLE
Send-Key 'Media_Play_Pause'
#>
function Send-Key {
    param([Parameter(Mandatory)][string]$Name)
    Send-Chord $Name
}

<#
.SYNOPSIS
Tells whether a key is held down right now. It stands in for AutoHotkey's GetKeyState.
.DESCRIPTION
Looks at the physical state of the key at the moment of the call. For whether a lock key such as CapsLock is switched on, use Test-KeyToggled.
.PARAMETER Name
The name of one key, as listed in the Chord note of Send-Chord, for example 'Shift' or 'F13'. The mouse buttons 'LButton' and 'RButton' work too.
.OUTPUTS
True while the key is held down, False when it is not.
.EXAMPLE
Test-KeyPressed 'Shift'
.EXAMPLE
if (Test-KeyPressed 'Ctrl') { Send-Chord 'Ctrl+Shift+t' }
#>
function Test-KeyPressed {
    param([Parameter(Mandatory)][string]$Name)
    ([Macropad.Native]::GetAsyncKeyState((Get-VirtualKey $Name)) -band 0x8000) -ne 0
}

<#
.SYNOPSIS
Clicks a mouse button at a point on the screen. It stands in for AutoHotkey's Click.
.DESCRIPTION
Moves the mouse pointer to the point, then presses and releases the button. A button name that is not listed raises an error before the pointer moves.
.PARAMETER X
How far from the left edge of the screen, in pixels.
.PARAMETER Y
How far from the top edge of the screen, in pixels.
.PARAMETER Button
Which button to click: 'Left', 'Right', 'Middle', or 'X1' or 'X2' for the two extra buttons at the side of some mice. Case does not matter.
.EXAMPLE
Send-Click 500 300
.EXAMPLE
Send-Click 500 300 -Button 'Right'
#>
function Send-Click {
    param([Parameter(Mandatory)][int]$X, [Parameter(Mandatory)][int]$Y, [string]$Button = 'Left')
    # Down flag, up flag, dwData (which X button).
    $buttons = @{
        Left   = @(0x2, 0x4, 0)
        Right  = @(0x8, 0x10, 0)
        Middle = @(0x20, 0x40, 0)
        X1     = @(0x80, 0x100, 1)
        X2     = @(0x80, 0x100, 2)
    }
    if (-not $buttons.ContainsKey($Button)) { throw "Unknown mouse button '$Button'" }
    $b = $buttons[$Button]
    [void][Macropad.Native]::SetCursorPos($X, $Y)
    [Macropad.Inject]::Mouse([uint32]$b[0], [uint32]$b[2])
    [Macropad.Inject]::Mouse([uint32]$b[1], [uint32]$b[2])
}
