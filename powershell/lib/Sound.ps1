# Sound volume
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

<#
.SYNOPSIS
Reads how loud the sound is, as a percentage. It stands in for AutoHotkey's SoundGetVolume.
.DESCRIPTION
Reads the main volume of the default playback device: the speakers or headphones that Windows plays sound through at the moment. An error is raised when Windows has no playback device.
.OUTPUTS
A whole number from 0 (silent) to 100 (loudest).
.EXAMPLE
Get-SoundVolume
#>
function Get-SoundVolume {
    [int][Math]::Round([Macropad.Audio]::GetVolume() * 100)
}

<#
.SYNOPSIS
Sets how loud the sound is, as a percentage. It stands in for AutoHotkey's SoundSetVolume.
.DESCRIPTION
Changes the main volume of the default playback device: the speakers or headphones that Windows plays sound through at the moment. The result never goes below 0 or above 100. An error is raised when Windows has no playback device. It does not change the muted state; see Set-SoundMute.
.PARAMETER Percent
The new volume from 0 (silent) to 100 (loudest), or, with -Relative, how much to add to the current volume (a negative number lowers it). Leaving it out means 0.
.PARAMETER Relative
Treat Percent as a change to the current volume instead of the new volume.
.OUTPUTS
Nothing. Get-SoundVolume shows the volume now.
.EXAMPLE
Set-SoundVolume 30
.EXAMPLE
Set-SoundVolume -10 -Relative
#>
function Set-SoundVolume {
    param([int]$Percent, [switch]$Relative)
    $current = 0
    if ($Relative) { $current = Get-SoundVolume }
    [Macropad.Audio]::SetVolume([float](ConvertTo-VolumeLevel $current $Percent -Relative:$Relative))
}

<#
.SYNOPSIS
Tells whether the sound is muted. It stands in for AutoHotkey's SoundGetMute.
.DESCRIPTION
Reads the muted state of the default playback device: the speakers or headphones that Windows plays sound through at the moment. An error is raised when Windows has no playback device.
.OUTPUTS
True when the sound is muted, False when it is not.
.EXAMPLE
Get-SoundMute
#>
function Get-SoundMute {
    [Macropad.Audio]::GetMute()
}

<#
.SYNOPSIS
Mutes the sound or lets it be heard again. It stands in for AutoHotkey's SoundSetMute.
.DESCRIPTION
Changes the muted state of the default playback device: the speakers or headphones that Windows plays sound through at the moment. The volume level is not changed. An error is raised when Windows has no playback device.
.PARAMETER Mute
$true to mute the sound, $false to unmute it. Leaving it out means $false.
.OUTPUTS
Nothing. Get-SoundMute shows the state now.
.EXAMPLE
Set-SoundMute $true
.EXAMPLE
Set-SoundMute $false
#>
function Set-SoundMute {
    param([bool]$Mute)
    [Macropad.Audio]::SetMute($Mute)
}

<#
.SYNOPSIS
Mutes the sound if it is on, and unmutes it if it is muted. It stands in for AutoHotkey's SoundSetMute with -1.
.DESCRIPTION
Reads the muted state of the default playback device (the speakers or headphones that Windows plays sound through at the moment) and sets the opposite. An error is raised when Windows has no playback device.
.OUTPUTS
Nothing. Get-SoundMute shows the state now.
.EXAMPLE
Switch-SoundMute
#>
function Switch-SoundMute {
    [Macropad.Audio]::SetMute(-not [Macropad.Audio]::GetMute())
}
