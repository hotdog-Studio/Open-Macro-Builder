BeforeAll { foreach ($f in 'Native', 'Interop', 'Sound') { . "$PSScriptRoot\..\lib\$f.ps1" } }
Describe 'ConvertTo-VolumeLevel' {
    It 'clamps absolute values' { ConvertTo-VolumeLevel 50 150 | Should -Be 1; ConvertTo-VolumeLevel 50 -5 | Should -Be 0; ConvertTo-VolumeLevel 50 25 | Should -Be 0.25 }
    It 'adds relative values' { ConvertTo-VolumeLevel 50 10 -Relative | Should -Be 0.6; ConvertTo-VolumeLevel 95 10 -Relative | Should -Be 1 }
}
Describe 'default playback device' -Tag Integration {
    It 'sets and restores volume and mute' {
        try { $vol = Get-SoundVolume; $mute = Get-SoundMute } catch {
            # Only a PC without a playback device skips. The call's error wraps what Audio.cs threw
            # ('Exception calling "GetVolume" ...'), so the cause is the innermost exception: the
            # InvalidOperationException that says exactly 'No default playback device'. Any other error
            # (a COM failure with a device present) is a defect of the product and fails the test.
            $cause = $_.Exception
            while ($cause.InnerException) { $cause = $cause.InnerException }
            if ($cause -isnot [System.InvalidOperationException] -or $cause.Message -cne 'No default playback device') { throw }
            Set-ItResult -Skipped -Because 'this PC has no default playback device (no sound output), so the volume and mute cannot be tried'; return
        }
        try {
            $target = if ($vol -ge 50) { $vol - 10 } else { $vol + 10 }
            Set-SoundVolume $target; Get-SoundVolume | Should -Be $target
            Switch-SoundMute; Get-SoundMute | Should -Be (-not $mute)
        } finally { Set-SoundVolume $vol; Set-SoundMute $mute }
    }
}
