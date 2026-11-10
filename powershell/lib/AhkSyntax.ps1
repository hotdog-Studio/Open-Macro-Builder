# AutoHotkey syntax: key names, Send strings, hotkey specs and hotstring specs.
# Pure parsing; nothing here sends input.

# AHK key names the chord table in Input.ps1 lacks. A separate table, so the reverse lookup of
# $script:VirtualKeys (Get-KeyNameFromKeys) is unchanged. Wheel values are AHK's pseudo vks.
$script:AhkKeyAliases = @{
    Esc = 0x1B; BS = 0x08; Del = 0x2E; Ins = 0x2D
    Control = 0x11; LControl = 0xA2; RControl = 0xA3
    AppsKey = 0x5D; Sleep = 0x5F
    NumpadMult = 0x6A; NumpadAdd = 0x6B; NumpadSub = 0x6D; NumpadDot = 0x6E; NumpadDiv = 0x6F
    Browser_Back = 0xA6; Browser_Forward = 0xA7; Browser_Refresh = 0xA8; Browser_Stop = 0xA9
    Browser_Search = 0xAA; Browser_Favorites = 0xAB; Browser_Home = 0xAC
    Launch_Mail = 0xB4; Launch_Media = 0xB5; Launch_App1 = 0xB6; Launch_App2 = 0xB7
    WheelLeft = 0x9C; WheelRight = 0x9D; WheelDown = 0x9E; WheelUp = 0x9F
}
foreach ($n in 0..9) { $script:AhkKeyAliases["Numpad$n"] = 0x60 + $n }

function Get-AhkVirtualKey {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Name)
    if ($Name -match '^vk([0-9A-Fa-f]{1,2})$') { return [Convert]::ToInt32($Matches[1], 16) }
    if ($script:AhkKeyAliases.ContainsKey($Name)) { return [int]$script:AhkKeyAliases[$Name] }
    Get-VirtualKey $Name
}

function New-AhkKeyEvent { param([int]$Vk, [bool]$Up) [pscustomobject]@{ Vk = $Vk; Char = 0; Up = $Up } }
function New-AhkCharEvent { param([int]$Char, [bool]$Up) [pscustomobject]@{ Vk = 0; Char = $Char; Up = $Up } }

# Down+up events for one literal character. LF and TAB become Enter and Tab; CR is dropped.
function ConvertTo-AhkCharEvents {
    param([char]$Char)
    switch ([int]$Char) {
        10 { return @((New-AhkKeyEvent 0x0D $false), (New-AhkKeyEvent 0x0D $true)) }
        9 { return @((New-AhkKeyEvent 0x09 $false), (New-AhkKeyEvent 0x09 $true)) }
        13 { return @() }
    }
    @((New-AhkCharEvent ([int]$Char) $false), (New-AhkCharEvent ([int]$Char) $true))
}

# AHK Send syntax -> @{ Blind; Events }. Each event is @{ Vk; Char; Up } (Char 0 = key event).
function ConvertFrom-AhkSend {
    param([Parameter(Mandatory)][AllowEmptyString()][string]$Keys)
    $events = [System.Collections.Generic.List[object]]::new()
    $blind = $false
    $i = 0
    if ($Keys.Length -ge 7 -and $Keys.Substring(0, 7) -eq '{Blind}') { $blind = $true; $i = 7 }
    $rest = $Keys.Substring($i)
    $textMatch = [regex]::Match($rest, '^\{(Text|Raw)\}', 'IgnoreCase')
    if ($textMatch.Success) {
        foreach ($c in $rest.Substring($textMatch.Length).ToCharArray()) { foreach ($ev in ConvertTo-AhkCharEvents $c) { $events.Add($ev) } }
        return [pscustomobject]@{ Blind = $blind; Events = $events.ToArray() }
    }

    $modVk = @{ '^' = @(0x11, 0xA2, 0xA3); '!' = @(0x12, 0xA4, 0xA5); '+' = @(0x10, 0xA0, 0xA1); '#' = @(0x5B, 0x5B, 0x5C) }
    $mods = [System.Collections.Generic.List[int]]::new()
    $side = 0   # 0 neutral, 1 left, 2 right
    while ($i -lt $Keys.Length) {
        $c = $Keys[$i]
        if (($c -eq '<' -or $c -eq '>') -and $i + 1 -lt $Keys.Length -and '^!+#'.IndexOf($Keys[$i + 1]) -ge 0) {
            if ($c -eq '<') { $side = 1 } else { $side = 2 }
            $i++; continue
        }
        if ('^!+#'.IndexOf($c) -ge 0) {
            $mods.Add($modVk[[string]$c][$side]); $side = 0
            $i++; continue
        }

        # The key itself: a list of events for this key, wrapped in the pending modifiers below.
        $keyEvents = [System.Collections.Generic.List[object]]::new()
        if ($c -eq '{') {
            $close = $Keys.IndexOf('}', $i + 1)
            if ($close -eq $i + 1 -and $i + 2 -lt $Keys.Length -and $Keys[$i + 2] -eq '}') { $close = $i + 2 }   # {}}
            if ($close -lt 0) { throw "Unbalanced braces in '$Keys'" }
            $content = $Keys.Substring($i + 1, $close - $i - 1)
            $i = $close + 1
            if ($content.Length -eq 1) {
                if ($mods.Count -gt 0) {
                    $vk = Get-AhkVirtualKey $content.ToLowerInvariant()
                    $keyEvents.Add((New-AhkKeyEvent $vk $false)); $keyEvents.Add((New-AhkKeyEvent $vk $true))
                } else {
                    foreach ($ev in ConvertTo-AhkCharEvents $content[0]) { $keyEvents.Add($ev) }
                }
            } elseif ($content -match '^U\+([0-9A-Fa-f]{1,6})$') {
                $code = [Convert]::ToInt32($Matches[1], 16)
                $keyEvents.Add((New-AhkCharEvent $code $false)); $keyEvents.Add((New-AhkCharEvent $code $true))
            } else {
                $parts = @($content.Trim() -split '\s+')
                $vk = Get-AhkVirtualKey $parts[0]
                $arg = ''
                if ($parts.Count -gt 1) { $arg = $parts[1] }
                if ($arg -eq 'down') { $keyEvents.Add((New-AhkKeyEvent $vk $false)) }
                elseif ($arg -eq 'up') { $keyEvents.Add((New-AhkKeyEvent $vk $true)) }
                else {
                    $count = 1
                    if ($arg -match '^\d+$') { $count = [int]$arg }
                    for ($n = 0; $n -lt $count; $n++) { $keyEvents.Add((New-AhkKeyEvent $vk $false)); $keyEvents.Add((New-AhkKeyEvent $vk $true)) }
                }
            }
        } else {
            $i++
            if ($mods.Count -gt 0) {
                $vk = Get-AhkVirtualKey ([string]$c).ToLowerInvariant()
                $keyEvents.Add((New-AhkKeyEvent $vk $false)); $keyEvents.Add((New-AhkKeyEvent $vk $true))
            } else {
                foreach ($ev in ConvertTo-AhkCharEvents $c) { $keyEvents.Add($ev) }
            }
        }

        foreach ($m in $mods) { $events.Add((New-AhkKeyEvent $m $false)) }
        foreach ($ev in $keyEvents) { $events.Add($ev) }
        for ($n = $mods.Count - 1; $n -ge 0; $n--) { $events.Add((New-AhkKeyEvent $mods[$n] $true)) }
        $mods.Clear(); $side = 0
    }
    [pscustomobject]@{ Blind = $blind; Events = $events.ToArray() }
}

# AHK hotkey spec -> @{ Vk; Mods; Wildcard; Passthrough; KeyUp; PrefixVk }.
# Mods packs two bits per modifier (Ctrl 0-1, Alt 2-3, Shift 4-5, Win 6-7): 0 up, 1 left, 2 right, 3 either.
function ConvertFrom-AhkHotkey {
    param([Parameter(Mandatory)][string]$Spec)
    $result = [pscustomobject]@{ Vk = 0; Mods = 0; Wildcard = $false; Passthrough = $false; KeyUp = $false; PrefixVk = 0 }
    $body = $Spec.Trim()
    if ($body -match '^(.*\S)\s+up$') {
        $rest = $Matches[1]
        # In 'a & Up' the Up is the arrow key after a prefix, not a release.
        if ($rest -notmatch '\s&$') { $result.KeyUp = $true; $body = $rest }
    }

    if ($body -match '^(.+?)\s+&\s+(.+)$') {
        $a = $Matches[1].Trim(); $b = $Matches[2].Trim()
        if ($a.StartsWith('~')) { $result.Passthrough = $true; $a = $a.Substring(1) }
        if (($a.Length -gt 1 -and '^!+#<>*$'.IndexOf($a[0]) -ge 0) -or ($b.Length -gt 1 -and '^!+#<>*$~'.IndexOf($b[0]) -ge 0)) {
            throw "Modifiers are not allowed in a custom combination: '$Spec'"
        }
        $result.PrefixVk = Get-AhkVirtualKey $a
        $result.Vk = Get-AhkVirtualKey $b
        return $result
    }

    $shift = @{ '^' = 0; '!' = 2; '+' = 4; '#' = 6 }
    $side = 3
    $i = 0
    while ($body.Length - $i -gt 1) {
        $c = $body[$i]
        if ($c -eq '~') { $result.Passthrough = $true }
        elseif ($c -eq '*') { $result.Wildcard = $true }
        elseif ($c -eq '$') { }
        elseif ($c -eq '<') { $side = 1 }
        elseif ($c -eq '>') { $side = 2 }
        elseif ($shift.ContainsKey([string]$c)) { $result.Mods = $result.Mods -bor ($side -shl $shift[[string]$c]); $side = 3 }
        else { break }
        $i++
    }
    $result.Vk = Get-AhkVirtualKey $body.Substring($i)
    $result
}

# AHK hotstring spec ':options:abbreviation' -> @{ Abbrev; Options; Execute }.
# Option bits: 1 '*' (no end char), 2 '?' (inside words), 4 'C' (case-sensitive),
# 8 'C1' (no case conforming), 16 'B0' (no backspacing), 32 'O' (omit end char).
function ConvertFrom-AhkHotstring {
    param([Parameter(Mandatory)][string]$Spec)
    if (-not $Spec.StartsWith(':') -or $Spec.IndexOf(':', 1) -lt 0) { throw "Invalid hotstring '$Spec'" }
    $second = $Spec.IndexOf(':', 1)
    $optionText = $Spec.Substring(1, $second - 1)
    $abbrev = $Spec.Substring($second + 1)
    if ($abbrev -eq '') { throw "Empty hotstring abbreviation in '$Spec'" }
    $options = 0
    $execute = $false
    foreach ($m in [regex]::Matches($optionText, '(.)([01]?)')) {
        $token = $m.Value
        $letter = $m.Groups[1].Value.ToUpperInvariant()
        $digit = $m.Groups[2].Value
        switch ($letter) {
            '*' { if ($digit -ne '0') { $options = $options -bor 1 } }
            '?' { if ($digit -ne '0') { $options = $options -bor 2 } }
            'C' { if ($digit -eq '1') { $options = $options -bor 8 } elseif ($digit -eq '') { $options = $options -bor 4 } }
            'B' { if ($digit -eq '0') { $options = $options -bor 16 } }
            'O' { if ($digit -ne '0') { $options = $options -bor 32 } }
            'X' { $execute = ($digit -ne '0') }
            { $_ -in 'T', 'R', 'Z' } { }
            default { throw "Unknown hotstring option '$token' in '$Spec'" }
        }
    }
    [pscustomobject]@{ Abbrev = $abbrev; Options = $options; Execute = $execute }
}
