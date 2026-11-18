# The delayed key and click forms (commands/custom/automation.ps1 and ahk/commands/custom/automation.ahk).
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native','Interop','Pump','Assets','Input','Model','Overlay','Window','Engine','AhkSyntax','WinTitle','Screen') { . "$ps\lib\$f.ps1" }
    . "$ps\commands\helper.ps1"
    . "$ps\commands\custom\automation.ps1"
    . "$PSScriptRoot\helpers\Ahk.ps1"
    function New-KeyArgs([System.Windows.Forms.Keys]$Keys) { [System.Windows.Forms.KeyEventArgs]::new($Keys) }
}
# The forms below are built but never shown: their handlers' work is done by named functions, which
# these tests call with mocks for every function that sends, clicks, reads the mouse or shows a box.
Describe 'Delayed key form, recording' {
    BeforeEach { $form = New-DelayedKeyForm; $st = $form.Tag }
    AfterEach { $st.Timeout.Dispose(); $form.Dispose() }
    It 'records a key with the modifiers held, and stops recording' {
        Start-KeyRecording $form
        $st.Recording | Should -BeTrue
        $e = New-KeyArgs 'T, Control, Shift'
        Add-RecordedKey $form $e
        $st.ChordBox.Text | Should -Be 'Ctrl+Shift+t'
        $st.Status.Text | Should -Be 'Recorded Ctrl+Shift+t.'
        $st.Recording | Should -BeFalse
        $e.SuppressKeyPress | Should -BeTrue
    }
    It 'waits past a modifier pressed on its own' {
        Start-KeyRecording $form
        Add-RecordedKey $form (New-KeyArgs 'ControlKey, Control')
        $st.ChordBox.Text | Should -Be ''
        $st.Recording | Should -BeTrue
    }
    It 'does not record a key that cannot be sent, and keeps recording' {
        Start-KeyRecording $form
        Add-RecordedKey $form (New-KeyArgs 'NumPad5')
        $st.ChordBox.Text | Should -Be ''
        $st.Status.Text | Should -Be 'NumPad5 cannot be sent; press another key.'
        $st.Recording | Should -BeTrue
    }
    It 'records a key the table has no name for by the character it types, so it can be sent again' {
        # en-GB: ' is vk C0, ` is vk DF, and vk DE (the US ' key) types #.
        Mock Get-LayoutVirtualKey { 0xC0 } -ParameterFilter { $Char -eq "'" }
        Mock Get-LayoutVirtualKey { 0xDF } -ParameterFilter { $Char -eq '`' }
        Mock Get-LayoutVirtualKey { 0xDE } -ParameterFilter { $Char -eq '#' }
        Mock Get-LayoutVirtualKey { -1 } -ParameterFilter { $Char -notin "'", '`', '#' }
        Mock Get-LayoutCharacter { '#' } -ParameterFilter { $Vk -eq 0xDE }
        Mock Get-LayoutCharacter { '' } -ParameterFilter { $Vk -ne 0xDE }
        Start-KeyRecording $form
        Add-RecordedKey $form (New-KeyArgs 'Oem7, Control')
        $st.ChordBox.Text | Should -Be 'Ctrl+#'
    }
    It 'records nothing when not recording' {
        Add-RecordedKey $form (New-KeyArgs 'T')
        $st.ChordBox.Text | Should -Be ''
    }
    It 'says so when the recording times out' {
        Start-KeyRecording $form
        Stop-KeyRecording $form
        $st.Recording | Should -BeFalse
        $st.Status.Text | Should -Be 'No key recorded; timed out.'
    }
}
Describe 'Delayed key form, scheduling and sending' {
    BeforeEach {
        $form = New-DelayedKeyForm; $st = $form.Tag
        Mock Show-MessageBox {}; Mock Start-PendingTimer {}; Mock Send-Chord {}
    }
    AfterEach { $st.Timeout.Dispose(); $form.Dispose() }
    It 'schedules the chord after the delay' {
        $st.ChordBox.Text = ' Ctrl+Shift+t '; $st.DelayBox.Text = '250'
        Invoke-DelayedKeySchedule $form
        $st.PendingChord | Should -Be 'Ctrl+Shift+t'
        Should -Invoke Start-PendingTimer -Times 1 -Exactly -ParameterFilter { $Delay -eq '250' -and $Form -eq $form }
        Should -Invoke Show-MessageBox -Times 0 -Exactly
    }
    It 'refuses <Chord> with <Delay> ms and says why' -ForEach @(
        @{ Chord = ''; Delay = '100'; Message = 'Enter a key and a delay in milliseconds.' }
        @{ Chord = 'Ctrl+t'; Delay = 'soon'; Message = 'Enter a key and a delay in milliseconds.' }
        @{ Chord = 'Ctrl+NumPad5'; Delay = '100'; Message = "Unknown key name 'NumPad5'" }
    ) {
        $st.ChordBox.Text = $Chord; $st.DelayBox.Text = $Delay
        Invoke-DelayedKeySchedule $form
        Should -Invoke Show-MessageBox -Times 1 -Exactly -ParameterFilter { $Text -eq $Message }
        Should -Invoke Start-PendingTimer -Times 0 -Exactly
    }
    It 'sends the scheduled chord when the time comes' {
        $st.PendingChord = 'Ctrl+Shift+t'
        Send-PendingChord $form
        Should -Invoke Send-Chord -Times 1 -Exactly -ParameterFilter { $Chord -eq 'Ctrl+Shift+t' }
    }
    It 'shows the error when the send fails' {
        Mock Send-Chord { throw 'no' }
        $st.PendingChord = 'Ctrl+Shift+t'
        Send-PendingChord $form
        Should -Invoke Show-MessageBox -Times 1 -Exactly -ParameterFilter { $Title -eq 'Delayed key failed' }
    }
}
Describe 'Delayed click form' {
    BeforeEach {
        $form = New-DelayedClickForm; $st = $form.Tag
        Mock Show-MessageBox {}; Mock Start-PendingTimer {}; Mock Send-Click {}
        Mock Get-MousePosition { [pscustomobject]@{ X = 10; Y = 20; Window = [IntPtr]::Zero; Control = [IntPtr]::Zero } }
    }
    AfterEach { $st.Poll.Dispose(); $form.Dispose() }
    It 'records the button pressed and where the pointer is' {
        Mock Get-PressedMouseButton { '' }
        Start-ClickRecording $form
        Mock Get-PressedMouseButton { 'Right' }
        Update-ClickCapture $form
        $st.Captured | Should -BeTrue
        "$($st.Button) $($st.X) $($st.Y)" | Should -Be 'Right 10 20'
        $st.Status.Text | Should -Be 'Captured Right click at 10, 20.'
    }
    It 'ignores the button that clicked Record until it is let go' {
        Mock Get-PressedMouseButton { 'Left' }
        Start-ClickRecording $form
        Update-ClickCapture $form
        $st.Captured | Should -BeFalse
        Mock Get-PressedMouseButton { '' }
        Update-ClickCapture $form
        Mock Get-PressedMouseButton { 'Left' }
        Update-ClickCapture $form
        $st.Captured | Should -BeTrue
    }
    It 'gives up after 5 seconds' {
        Mock Get-PressedMouseButton { '' }
        Start-ClickRecording $form
        $st.Started = [Environment]::TickCount - 6000
        Update-ClickCapture $form
        $st.Status.Text | Should -Be 'No click recorded; timed out.'
        $st.Poll.Enabled | Should -BeFalse
    }
    It 'schedules the recorded click and clicks it when the time comes' {
        $st.Captured = $true; $st.X = 10; $st.Y = 20; $st.Button = 'Right'; $st.DelayBox.Text = '100'
        Invoke-DelayedClickSchedule $form
        Should -Invoke Start-PendingTimer -Times 1 -Exactly -ParameterFilter { $Delay -eq '100' }
        Send-PendingClick $form
        Should -Invoke Send-Click -Times 1 -Exactly -ParameterFilter { $X -eq 10 -and $Y -eq 20 -and $Button -eq 'Right' }
    }
    It 'refuses to schedule before a click is recorded' {
        $st.DelayBox.Text = '100'
        Invoke-DelayedClickSchedule $form
        Should -Invoke Show-MessageBox -Times 1 -Exactly -ParameterFilter { $Text -eq 'Record a click and enter a delay in milliseconds.' }
        Should -Invoke Start-PendingTimer -Times 0 -Exactly
    }
}
Describe 'Get-PressedMouseButton' {
    It 'names the button that is down' {
        Mock Test-KeyPressed { $Name -eq 'RButton' }
        Get-PressedMouseButton | Should -Be 'Right'
        Mock Test-KeyPressed { $false }
        Get-PressedMouseButton | Should -Be ''
    }
}
Describe 'Start-PendingTimer' {
    It 'waits at least 1 ms and at most Int32.MaxValue ms' {
        $form = New-Object System.Windows.Forms.Form; $form.Tag = @{ PendingTimer = $null }
        try {
            Start-PendingTimer $form '0' { param($sender, $e) }
            $form.Tag.PendingTimer.Interval | Should -Be 1
            Start-PendingTimer $form '99999999999999999999' { param($sender, $e) }
            $form.Tag.PendingTimer.Interval | Should -Be ([int]::MaxValue)
        } finally { $form.Tag.PendingTimer.Stop(); $form.Tag.PendingTimer.Dispose(); $form.Dispose() }
    }
}
Describe 'Delayed key and click forms' {
    # Built with the builders ShowDelayedKeyForm / ShowDelayedClickForm call, never shown: no window
    # appears or takes focus while the tests run.
    It '<Builder> cancels the pending send of the form it replaces' -ForEach @(
        @{ Builder = 'New-DelayedKeyForm' }
        @{ Builder = 'New-DelayedClickForm' }
    ) {
        $old = & $Builder
        $new = $null
        try {
            Start-PendingTimer $old 60000 { param($sender, $e) }
            $timer = $old.Tag.PendingTimer
            $new = & $Builder
            $timer.Enabled | Should -BeFalse
            $old.IsDisposed | Should -BeTrue
            $new.Visible | Should -BeFalse
        } finally {
            foreach ($form in @($old, $new)) { if ($null -ne $form -and -not $form.IsDisposed) { $form.Dispose() } }
        }
    }
}
Describe 'AutoHotkey delayed key form' -Tag Integration {
    It 'cancels a scheduled send when the form is opened again' {
        if (-not (Get-AhkExe)) { Set-ItResult -Skipped -Because 'AutoHotkey v2 is not installed'; return }
        $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
        # The check script sends vkE9, a key that types nothing, which a hook here counts (and
        # swallows). A hook outside AutoHotkey sees both SendInput and SendEvent.
        $hook = [Macropad.InputHook]::new(); $hook.Context = @{ Count = 0 }
        $hook.AddHotkey(0, 0xE9, 0, 1, 0, 0)
        $hook.add_Fired({ param($sender, $e) $sender.Context.Count++ })
        if (-not $hook.Start()) { throw 'Could not install the test keyboard hook.' }
        try {
            $r = Invoke-AhkScript "$root\ahk\tests\automation_check.ahk"
            Wait-Pump 300
            $r.ExitCode | Should -Be 0 -Because $r.Err
            $r.Out.Trim() | Should -Be 'done'
            $hook.Context.Count | Should -Be 1 -Because 'only the schedule that was not followed by reopening the form may send'
        } finally { $hook.Dispose() }
    }
}
