BeforeAll { foreach ($f in 'Native', 'Interop', 'Sound') { . "$PSScriptRoot\..\lib\$f.ps1" } }
Describe 'ConvertTo-VolumeLevel' {
    It 'clamps absolute values' { ConvertTo-VolumeLevel 50 150 | Should -Be 1; ConvertTo-VolumeLevel 50 -5 | Should -Be 0; ConvertTo-VolumeLevel 50 25 | Should -Be 0.25 }
    It 'adds relative values' { ConvertTo-VolumeLevel 50 10 -Relative | Should -Be 0.6; ConvertTo-VolumeLevel 95 10 -Relative | Should -Be 1 }
}
Describe 'default playback device' -Tag Integration {
    It 'sets and restores volume and mute' {
        try { $vol = Get-SoundVolume; $mute = Get-SoundMute } catch {
            # The error says it in the words of the call ('Exception calling "GetVolume" ...'); a build log
            # reads better with the cause first. Any other error is passed on as it is.
            $cause = if ($_.Exception.Message -match 'No default playback device') { 'this PC has no default playback device (no sound output), so the volume and mute cannot be tried' } else { $_.Exception.Message }
            Set-ItResult -Skipped -Because $cause; return
        }
        try {
            $target = if ($vol -ge 50) { $vol - 10 } else { $vol + 10 }
            Set-SoundVolume $target; Get-SoundVolume | Should -Be $target
            Switch-SoundMute; Get-SoundMute | Should -Be (-not $mute)
        } finally { Set-SoundVolume $vol; Set-SoundMute $mute }
    }
}
