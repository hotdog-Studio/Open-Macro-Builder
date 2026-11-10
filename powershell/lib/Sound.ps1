# AHK SoundGetVolume / SoundSetVolume / SoundGetMute / SoundSetMute for the default playback
# device. (Named Sound* to stay clear of the Storage module's Get-Volume.)

# Target level 0-1 from a percentage, absolute or relative to $Current, clamped to 0-100 %.
function ConvertTo-VolumeLevel {
    param([int]$Current, [int]$Percent, [switch]$Relative)
    $target = $Percent
    if ($Relative) { $target = $Current + $Percent }
    $target = [Math]::Max(0, [Math]::Min(100, $target))
    $target / 100.0
}

function Get-SoundVolume {
    [int][Math]::Round([Macropad.Audio]::GetVolume() * 100)
}

function Set-SoundVolume {
    param([int]$Percent, [switch]$Relative)
    $current = 0
    if ($Relative) { $current = Get-SoundVolume }
    [Macropad.Audio]::SetVolume([float](ConvertTo-VolumeLevel $current $Percent -Relative:$Relative))
}

function Get-SoundMute {
    [Macropad.Audio]::GetMute()
}

function Set-SoundMute {
    param([bool]$Mute)
    [Macropad.Audio]::SetMute($Mute)
}

# AHK SoundSetMute -1.
function Switch-SoundMute {
    [Macropad.Audio]::SetMute(-not [Macropad.Audio]::GetMute())
}
