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
    foreach ($ev in @($Events)) {
        $k = [Macropad.KeyInput]::new()
        $k.Vk = [int]$ev.Vk
        $k.Char = [int]$ev.Char
        $k.Up = [bool]$ev.Up
        $k.Extended = ($k.Char -eq 0) -and (Test-ExtendedKey $k.Vk)
        $list.Add($k)
    }
    , $list.ToArray()
}

# A seam for tests: one SendInput call.
function Send-KeyInput {
    param([Macropad.KeyInput[]]$Inputs)
    [void][Macropad.Inject]::Send($Inputs)
}

# AHK Send. Without {Blind}, held modifiers are released first (behind a 0xE8 tap when Win or
# Alt is held, so releasing them opens no menu) and are not pressed again afterwards.
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

function Send-Text {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
    Send-Ahk ('{Text}' + $Text)
}

# AHK KeyWait: waits until the key is up (or down with -Down). $false on timeout; 0 waits forever.
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

function Test-KeyToggled {
    param([Parameter(Mandatory)][ValidateSet('CapsLock', 'NumLock', 'ScrollLock', 'Insert')][string]$Name)
    ([Macropad.Native]::GetKeyState((Get-VirtualKey $Name)) -band 1) -ne 0
}

# AHK SetCapsLockState / SetNumLockState / SetScrollLockState.
function Set-LockKeyState {
    param([Parameter(Mandatory)][ValidateSet('CapsLock', 'NumLock', 'ScrollLock')][string]$Name, [bool]$On)
    if ((Test-KeyToggled $Name) -eq $On) { return }
    $vk = Get-VirtualKey $Name
    Send-KeyInput (ConvertTo-KeyInput @(
        [pscustomobject]@{ Vk = $vk; Char = 0; Up = $false },
        [pscustomobject]@{ Vk = $vk; Char = 0; Up = $true }))
}
