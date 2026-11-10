# Delayed key and click forms (ahk/commands/custom/automation.ahk).
# Each form keeps its state in a hashtable on $form.Tag. Handlers are { param($sender, $e) } and reach
# that state through $sender.FindForm().Tag, or $sender.Tag for timers, which carry the form.

# Chord name for a WinForms key code (the reverse of Get-VirtualKey), e.g. Keys.Oem5 -> '\'.
function Get-KeyNameFromKeys {
    param([System.Windows.Forms.Keys]$KeyCode)
    $vk = [int]$KeyCode -band 0xFFFF
    $names = @($script:VirtualKeys.GetEnumerator() | Where-Object { $_.Value -eq $vk -and $_.Key -ne 'Win' } | ForEach-Object { $_.Key })
    if ($names.Count -gt 0) { return @($names | Sort-Object)[0] }
    $KeyCode.ToString()
}

function New-AutomationForm {
    param([string]$Name, [string]$Title, [int]$Height)
    # Showing a form again replaces the previous one.
    foreach ($old in @([System.Windows.Forms.Application]::OpenForms | Where-Object { $_.Name -eq $Name })) { $old.Dispose() }
    $form = New-Object System.Windows.Forms.Form
    $form.Name = $Name
    $form.Text = $Title
    $form.TopMost = $true
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.StartPosition = 'CenterScreen'
    $form.ClientSize = New-Object System.Drawing.Size(320, $Height)
    $form
}

function Add-AutomationControl {
    param($Form, [string]$Type, [string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height = 23)
    $control = New-Object "System.Windows.Forms.$Type"
    $control.Text = $Text
    $control.SetBounds($X, $Y, $Width, $Height)
    $Form.Controls.Add($control)
    $control
}

function Get-PressedMouseButton {
    foreach ($pair in @(@('LButton', 'Left'), @('RButton', 'Right'), @('MButton', 'Middle'), @('XButton1', 'X1'), @('XButton2', 'X2'))) {
        if (Test-KeyPressed $pair[0]) { return $pair[1] }
    }
    ''
}

# Replaces any pending one-shot timer on the form state and starts a new one.
function Start-PendingTimer {
    param($Form, [string]$Delay, [scriptblock]$OnTick)
    $state = $Form.Tag
    if ($null -ne $state.PendingTimer) { $state.PendingTimer.Stop(); $state.PendingTimer.Dispose() }
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = [int][Math]::Max(1, [Math]::Min([double]$Delay, [int]::MaxValue))
    $timer.Tag = $Form
    $timer.add_Tick($OnTick)
    $state.PendingTimer = $timer
    $timer.Start()
}

function ShowDelayedKeyForm {
    param($Macro)
    $form = New-AutomationForm 'MacropadDelayedKeyForm' 'Send key after delay' 168
    $form.KeyPreview = $true
    $state = @{ Recording = $false; PendingChord = ''; PendingTimer = $null }
    $form.Tag = $state

    [void](Add-AutomationControl $form 'Label' 'Key chord, for example Ctrl+Shift+t:' 10 10 300 18)
    $state.ChordBox = Add-AutomationControl $form 'TextBox' '' 10 30 200
    $record = Add-AutomationControl $form 'Button' 'Record key' 220 29 90
    $state.Status = Add-AutomationControl $form 'Label' 'Click Record key; recording times out after 5 seconds.' 10 58 300 18
    [void](Add-AutomationControl $form 'Label' 'Delay in milliseconds:' 10 82 300 18)
    $state.DelayBox = Add-AutomationControl $form 'TextBox' '1000' 10 102 100
    $schedule = Add-AutomationControl $form 'Button' 'Schedule' 10 134 90
    $form.AcceptButton = $schedule

    $state.Timeout = New-Object System.Windows.Forms.Timer
    $state.Timeout.Interval = 5000
    $state.Timeout.Tag = $form
    $state.Timeout.add_Tick({
        param($sender, $e)
        $sender.Stop()
        $f = $sender.Tag
        if ($f.IsDisposed) { return }
        if ($f.Tag.Recording) {
            $f.Tag.Recording = $false
            $f.Tag.Status.Text = 'No key recorded; timed out.'
        }
    })

    $record.add_Click({
        param($sender, $e)
        $st = $sender.FindForm().Tag
        $st.Recording = $true
        $st.Status.Text = 'Press a key (5-second timeout)...'
        $st.Timeout.Stop(); $st.Timeout.Start()
        [void]$st.ChordBox.Focus()
    })

    # While recording, Enter, Tab, Escape and the arrows reach KeyDown instead of acting as dialog keys.
    $state.ChordBox.add_PreviewKeyDown({
        param($sender, $e)
        if ($sender.FindForm().Tag.Recording) { $e.IsInputKey = $true }
    })

    $form.add_KeyDown({
        param($sender, $e)
        $st = $sender.Tag
        if (-not $st.Recording) { return }
        if (@('ShiftKey', 'ControlKey', 'Menu', 'LWin', 'RWin') -contains $e.KeyCode.ToString()) { return }
        $parts = [System.Collections.Generic.List[string]]::new()
        if ($e.Control) { $parts.Add('Ctrl') }
        if ($e.Shift) { $parts.Add('Shift') }
        if ($e.Alt) { $parts.Add('Alt') }
        $parts.Add((Get-KeyNameFromKeys $e.KeyCode))
        $st.ChordBox.Text = $parts -join '+'
        $st.Recording = $false
        $st.Timeout.Stop()
        $st.Status.Text = "Recorded $($st.ChordBox.Text)."
        $e.Handled = $true
        $e.SuppressKeyPress = $true
    })

    $schedule.add_Click({
        param($sender, $e)
        $f = $sender.FindForm()
        $st = $f.Tag
        $chord = $st.ChordBox.Text.Trim()
        $delay = $st.DelayBox.Text.Trim()
        if (-not $chord -or $delay -notmatch '^\d+$') {
            [void][System.Windows.Forms.MessageBox]::Show('Enter a key and a delay in milliseconds.', 'Invalid input')
            return
        }
        $st.Recording = $false
        $st.PendingChord = $chord
        $f.Hide()
        Start-PendingTimer $f $delay {
            param($sender, $e)
            $sender.Stop()
            $chord = $sender.Tag.Tag.PendingChord
            try { Send-Chord $chord }
            catch { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Delayed key failed') }
        }
    })

    $form.Show()
    $form.Activate()
}

function ShowDelayedClickForm {
    param($Macro)
    $form = New-AutomationForm 'MacropadDelayedClickForm' 'Click after delay' 140
    $state = @{ Captured = $false; X = 0; Y = 0; Button = ''; Started = 0; WaitingForRelease = $false; PendingTimer = $null }
    $form.Tag = $state

    [void](Add-AutomationControl $form 'Label' 'Record a mouse click, then schedule its replay:' 10 10 300 18)
    $record = Add-AutomationControl $form 'Button' 'Record click' 10 30 100
    $state.Status = Add-AutomationControl $form 'Label' 'Click Record; capture times out after 5 seconds.' 10 60 300 18
    [void](Add-AutomationControl $form 'Label' 'Delay in milliseconds:' 10 84 300 18)
    $state.DelayBox = Add-AutomationControl $form 'TextBox' '1000' 10 104 100
    $schedule = Add-AutomationControl $form 'Button' 'Schedule' 120 103 90
    $form.AcceptButton = $schedule

    $state.Poll = New-Object System.Windows.Forms.Timer
    $state.Poll.Interval = 10
    $state.Poll.Tag = $form
    $state.Poll.add_Tick({
        param($sender, $e)
        $f = $sender.Tag
        if ($f.IsDisposed) { $sender.Stop(); return }
        $st = $f.Tag
        if ([Environment]::TickCount - $st.Started -ge 5000) {
            $sender.Stop()
            $st.Status.Text = 'No click recorded; timed out.'
            return
        }
        $button = Get-PressedMouseButton
        # Ignore the button that clicked Record until it is released.
        if ($st.WaitingForRelease) {
            if (-not $button) { $st.WaitingForRelease = $false }
            return
        }
        if (-not $button) { return }
        $p = [System.Windows.Forms.Cursor]::Position
        $st.X = $p.X; $st.Y = $p.Y; $st.Button = $button; $st.Captured = $true
        $sender.Stop()
        $st.Status.Text = "Captured $button click at $($p.X), $($p.Y)."
    })

    $record.add_Click({
        param($sender, $e)
        $st = $sender.FindForm().Tag
        $st.Poll.Stop()
        $st.Captured = $false
        $st.Started = [Environment]::TickCount
        $st.WaitingForRelease = [bool](Get-PressedMouseButton)
        $st.Status.Text = 'Click a mouse button (5-second timeout)...'
        $st.Poll.Start()
    })

    $schedule.add_Click({
        param($sender, $e)
        $f = $sender.FindForm()
        $st = $f.Tag
        $delay = $st.DelayBox.Text.Trim()
        if (-not $st.Captured -or $delay -notmatch '^\d+$') {
            [void][System.Windows.Forms.MessageBox]::Show('Record a click and enter a delay in milliseconds.', 'Invalid input')
            return
        }
        $st.PendingX = $st.X; $st.PendingY = $st.Y; $st.PendingButton = $st.Button
        $f.Hide()
        Start-PendingTimer $f $delay {
            param($sender, $e)
            $sender.Stop()
            $st = $sender.Tag.Tag
            try { Send-Click $st.PendingX $st.PendingY $st.PendingButton }
            catch { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Delayed click failed') }
        }
    })

    $form.Show()
    $form.Activate()
}
