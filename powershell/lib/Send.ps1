# Typing and waiting for keys
# AHK-style sending (Send, SendText, KeyWait, lock keys) on tagged SendInput.

# A seam for tests: is the key physically down right now?
function Test-VirtualKeyDown {
    param([int]$Vk)
    ([Macropad.Native]::GetAsyncKeyState($Vk) -band 0x8000) -ne 0
}

# Shift, Ctrl, Alt (left and right) and the Win keys that are currently down.
function Get-HeldModifier {
    @(@(0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C) | Where-Object { Test-VirtualKeyDown $_ })
}

function ConvertTo-KeyInput {
    param([object[]]$Events)
    $list = [System.Collections.Generic.List[Macropad.KeyInput]]::new()
    # Scan codes come from the active window's layout, the one the key names were read from.
    $layout = Get-ForegroundKeyboardLayout
    foreach ($ev in @($Events)) {
        $k = [Macropad.KeyInput]::new()
        $k.Vk = [int]$ev.Vk
        $k.Char = [int]$ev.Char
        $k.Up = [bool]$ev.Up
        $k.Extended = ($k.Char -eq 0) -and (Test-ExtendedKey $k.Vk)
        if ($k.Char -eq 0) { $k.Scan = Get-LayoutScanCode $k.Vk $layout } else { $k.Scan = 0 }
        $list.Add($k)
    }
    , $list.ToArray()
}

# A seam for tests: one SendInput call.
function Send-KeyInput {
    param([Macropad.KeyInput[]]$Inputs)
    [void][Macropad.Inject]::Send($Inputs)
}

<#
.SYNOPSIS
Sends keys written in AutoHotkey's Send syntax, such as '^c'. It stands in for AutoHotkey's Send, SendInput and SendEvent.
.DESCRIPTION
Types what Keys says. Without {Blind}, any Shift, Ctrl, Alt or Win key held down when the macro runs is let go first (so Alt or Win do not open a menu as they are released) and is not pressed again afterwards.
.PARAMETER Keys
What to send. Ordinary characters are typed as they are. A ^ before a key holds Ctrl for it, ! holds Alt, + holds Shift and # holds the Windows key; they can be combined, so '^+t' is Ctrl+Shift+t. Put < or > in front of the symbol for the left or right key only. A key name goes in braces: '{Enter}', '{F5}', '{Left}'. A number after the name repeats it ('{Tab 3}'), and 'down' or 'up' after the name only presses or only releases it ('{Shift down}'). The names are those of Send-Chord, AutoHotkey's other names such as Esc, Del, Numpad5 and Browser_Back, and 'vk' followed by a hexadecimal key code such as vk41. To type ^ ! + # { or } themselves, put one in braces: '{!}', '{{}', '{}}'. '{U+20AC}' types the character with that Unicode number. Start with '{Text}' (or '{Raw}') to type the rest exactly as written, with no symbol special; a new line is sent as Enter and a tab as Tab. Start with '{Blind}' to leave held modifier keys alone. An unknown key name or an unclosed brace raises an error and sends nothing.
.EXAMPLE
Send-Ahk '^c'
.EXAMPLE
Send-Ahk '#{Left}'
.EXAMPLE
Send-Ahk '{Tab 3}{Enter}'
#>
function Send-Ahk {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Keys)
    $parsed = ConvertFrom-AhkSend $Keys
    $events = [System.Collections.Generic.List[object]]::new()
    if (-not $parsed.Blind) {
        $held = @(Get-HeldModifier)
        if (@($held | Where-Object { @(0xA4, 0xA5, 0x5B, 0x5C) -contains $_ }).Count -gt 0) {
            $events.Add([pscustomobject]@{ Vk = 0xE8; Char = 0; Up = $false })
            $events.Add([pscustomobject]@{ Vk = 0xE8; Char = 0; Up = $true })
        }
        foreach ($vk in $held) { $events.Add([pscustomobject]@{ Vk = $vk; Char = 0; Up = $true }) }
    }
    foreach ($ev in @($parsed.Events)) { $events.Add($ev) }
    Send-KeyInput (ConvertTo-KeyInput $events.ToArray())
}

<#
.SYNOPSIS
Types text exactly as written. It stands in for AutoHotkey's SendText.
.DESCRIPTION
Types every character as it is, so ^ ! + # { and } are typed like any other character. A new line is sent as Enter and a tab as Tab. Like Send-Ahk, it first lets go of any Shift, Ctrl, Alt or Win key that is held down and does not press them again afterwards.
.PARAMETER Text
The text to type.
.EXAMPLE
Send-Text 'hello@example.com'
.EXAMPLE
Send-Text 'Total: 5 + 3 = 8 {done}'
#>
function Send-Text {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    Send-Ahk ('{Text}' + $Text)
}

<#
.SYNOPSIS
Waits until a key is let go of, or pressed down with -Down. It stands in for AutoHotkey's KeyWait.
.DESCRIPTION
Looks at the physical state of the key and returns as soon as it is in the wanted state (at once if it already is). The macropad stays responsive while it waits. If the macropad is closed or reloaded during the wait, the macro is stopped.
.PARAMETER Name
The name of the key: one from the Chord note of Send-Chord, an AutoHotkey name such as 'Esc', or 'vk' followed by a hexadecimal key code such as 'vk41'.
.PARAMETER Down
Wait until the key is pressed down, instead of until it is let go of.
.PARAMETER TimeoutMs
The longest time to wait, in milliseconds (1000 is one second). 0 waits for ever.
.OUTPUTS
True when the key reached the wanted state, False when the time ran out first.
.EXAMPLE
Wait-Key 'Ctrl'
.EXAMPLE
Wait-Key 'Space' -Down -TimeoutMs 3000
#>
function Wait-Key {
    param([Parameter(Mandatory)][string]$Name, [switch]$Down, [int]$TimeoutMs = 0)
    $vk = Get-AhkVirtualKey $Name
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        if ((Test-VirtualKeyDown $vk) -eq [bool]$Down) { return $true }
        if ($TimeoutMs -gt 0 -and $sw.ElapsedMilliseconds -ge $TimeoutMs) { return $false }
        Wait-Pump 10
    }
}

<#
.SYNOPSIS
Tells whether CapsLock, NumLock, ScrollLock or Insert is switched on. It stands in for AutoHotkey's GetKeyState.
.DESCRIPTION
Reads the on or off state of a key that switches between two states each time it is pressed. For CapsLock, NumLock and ScrollLock, on is when the key's light is lit, on a keyboard that has one. For Insert, Windows only switches the state each time the key is pressed: it does not tell whether the program you are typing in writes over text, because each program keeps that for itself. For whether a key is held down right now, use Test-KeyPressed.
.PARAMETER Name
The key to check: 'CapsLock', 'NumLock', 'ScrollLock' or 'Insert'.
.OUTPUTS
True when the key is switched on, False when it is off.
.EXAMPLE
Test-KeyToggled 'CapsLock'
#>
function Test-KeyToggled {
    param([Parameter(Mandatory)][ValidateSet('CapsLock', 'NumLock', 'ScrollLock', 'Insert')][string]$Name)
    ([Macropad.Native]::GetKeyState((Get-VirtualKey $Name)) -band 1) -ne 0
}

<#
.SYNOPSIS
Switches CapsLock, NumLock or ScrollLock on or off. It stands in for AutoHotkey's SetCapsLockState, SetNumLockState and SetScrollLockState.
.DESCRIPTION
Taps the key only when its state is not the wanted one, so calling it twice does no harm.
.PARAMETER Name
The lock key to set.
.PARAMETER On
$true to switch the key on, $false to switch it off. Leaving it out switches the key off.
.EXAMPLE
Set-LockKeyState 'CapsLock' $false
.EXAMPLE
Set-LockKeyState 'NumLock' $true
#>
function Set-LockKeyState {
    param([Parameter(Mandatory)][ValidateSet('CapsLock', 'NumLock', 'ScrollLock')][string]$Name, [bool]$On)
    if ((Test-KeyToggled $Name) -eq $On) { return }
    $vk = Get-VirtualKey $Name
    Send-KeyInput (ConvertTo-KeyInput @(
        [pscustomobject]@{ Vk = $vk; Char = 0; Up = $false },
        [pscustomobject]@{ Vk = $vk; Char = 0; Up = $true }))
}
