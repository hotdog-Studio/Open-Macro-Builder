# Delayed key and click forms (ahk/commands/custom/automation.ahk).
# Each form keeps its state in a hashtable on $form.Tag. Handlers are { param($sender, $e) } and hand
# the form to a named function below: $sender.FindForm() for controls, $sender.Tag for timers, which
# carry the form. The named functions can be tested on a form that is never shown.

# Chord name for a WinForms key code (the reverse of Get-VirtualKey), e.g. Keys.Oem5 -> '\'. Asking
# Get-VirtualKey keeps a symbol name true to the keyboard layout: the name given presses this key.
function Get-KeyNameFromKeys {
    param([System.Windows.Forms.Keys]$KeyCode)
    $vk = [int]$KeyCode -band 0xFFFF
    $names = @($script:VirtualKeys.Keys | Where-Object { $_ -ne 'Win' -and (Get-VirtualKey $_) -eq $vk })
    if ($names.Count -gt 0) { return @($names | Sort-Object)[0] }
    # A key the table has no name for, such as # on a UK keyboard: the character it types on its own,
    # when that character, used as a name, presses this key again.
    $char = (Get-LayoutCharacter $vk).ToLowerInvariant()
    if ($char) {
        try { if ((Get-VirtualKey $char) -eq $vk) { return $char } } catch { }
    }
    $KeyCode.ToString()
}

# True when Send-Chord knows every key name in Chord; ConvertTo-KeyEvent checks them and sends nothing.
function Test-ChordText {
    param([string]$Chord)
    if ([string]::IsNullOrWhiteSpace($Chord)) { return $false }
    try { [void](ConvertTo-KeyEvent $Chord); $true } catch { $false }
}

function New-AutomationForm {
    param([string]$Name, [string]$Title, [int]$Height)
    # Showing a form again replaces the previous one and cancels the send it scheduled.
    foreach ($old in @([System.Windows.Forms.Application]::OpenForms | Where-Object { $_.Name -eq $Name })) {
        if ($old.Tag -is [hashtable] -and $null -ne $old.Tag.PendingTimer) { $old.Tag.PendingTimer.Stop(); $old.Tag.PendingTimer.Dispose() }
        $old.Dispose()
    }
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

# ---- Delayed key form ----

function New-DelayedKeyForm {
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
    $state.Timeout.add_Tick({ param($sender, $e) $sender.Stop(); Stop-KeyRecording $sender.Tag })
    $record.add_Click({ param($sender, $e) Start-KeyRecording $sender.FindForm() })
    # While recording, Enter, Tab, Escape and the arrows reach KeyDown instead of acting as dialog keys.
    $state.ChordBox.add_PreviewKeyDown({
        param($sender, $e)
        if ($sender.FindForm().Tag.Recording) { $e.IsInputKey = $true }
    })
    $form.add_KeyDown({ param($sender, $e) Add-RecordedKey $sender $e })
    $schedule.add_Click({ param($sender, $e) Invoke-DelayedKeySchedule $sender.FindForm() })
    $form
}

function Start-KeyRecording {
    param($Form)
    $st = $Form.Tag
    $st.Recording = $true
    $st.Status.Text = 'Press a key (5-second timeout)...'
    $st.Timeout.Stop(); $st.Timeout.Start()
    [void]$st.ChordBox.Focus()
}

# The recording's 5 seconds are up.
function Stop-KeyRecording {
    param($Form)
    if ($Form.IsDisposed) { return }
    $st = $Form.Tag
    if ($st.Recording) {
        $st.Recording = $false
        $st.Status.Text = 'No key recorded; timed out.'
    }
}

# A key went down on the form ($KeyEvent: KeyEventArgs). While recording, the key and the modifiers
# held with it become the chord, unless the key is a modifier alone or one Send-Chord cannot send.
function Add-RecordedKey {
    param($Form, $KeyEvent)
    $st = $Form.Tag
    if (-not $st.Recording) { return }
    if (@('ShiftKey', 'ControlKey', 'Menu', 'LWin', 'RWin') -contains $KeyEvent.KeyCode.ToString()) { return }
    $KeyEvent.Handled = $true
    $KeyEvent.SuppressKeyPress = $true
    $name = Get-KeyNameFromKeys $KeyEvent.KeyCode
    if (-not (Test-ChordText $name)) {
        $st.Status.Text = "$name cannot be sent; press another key."
        return
    }
    $parts = [System.Collections.Generic.List[string]]::new()
    if ($KeyEvent.Control) { $parts.Add('Ctrl') }
    if ($KeyEvent.Shift) { $parts.Add('Shift') }
    if ($KeyEvent.Alt) { $parts.Add('Alt') }
    $parts.Add($name)
    $st.ChordBox.Text = $parts -join '+'
    $st.Recording = $false
    $st.Timeout.Stop()
    $st.Status.Text = "Recorded $($st.ChordBox.Text)."
}

# The Schedule button: checks the chord and the delay, hides the form and sends the chord later.
function Invoke-DelayedKeySchedule {
    param($Form)
    $st = $Form.Tag
    $chord = $st.ChordBox.Text.Trim()
    $delay = $st.DelayBox.Text.Trim()
    if (-not $chord -or $delay -notmatch '^\d+$') {
        Show-MessageBox 'Enter a key and a delay in milliseconds.' 'Invalid input'
        return
    }
    # Every key name is checked now, not when the time comes and the form is gone.
    try { [void](ConvertTo-KeyEvent $chord) }
    catch { Show-MessageBox $_.Exception.Message 'Invalid input'; return }
    $st.Recording = $false
    $st.PendingChord = $chord
    $Form.Hide()
    Start-PendingTimer $Form $delay { param($sender, $e) $sender.Stop(); Send-PendingChord $sender.Tag }
}

function Send-PendingChord {
    param($Form)
    try { Send-Chord $Form.Tag.PendingChord }
    catch { Show-MessageBox $_.Exception.Message 'Delayed key failed' }
}

function ShowDelayedKeyForm {
    param($Macro)
    $form = New-DelayedKeyForm
    $form.Show()
    $form.Activate()
}

# ---- Delayed click form ----

function New-DelayedClickForm {
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
    $state.Poll.add_Tick({ param($sender, $e) Update-ClickCapture $sender.Tag })
    $record.add_Click({ param($sender, $e) Start-ClickRecording $sender.FindForm() })
    $schedule.add_Click({ param($sender, $e) Invoke-DelayedClickSchedule $sender.FindForm() })
    $form
}

function Start-ClickRecording {
    param($Form)
    $st = $Form.Tag
    $st.Poll.Stop()
    $st.Captured = $false
    $st.Started = [Environment]::TickCount
    # Ignore the button that clicked Record until it is released.
    $st.WaitingForRelease = [bool](Get-PressedMouseButton)
    $st.Status.Text = 'Click a mouse button (5-second timeout)...'
    $st.Poll.Start()
}

# One look at the mouse while recording (the Poll timer, every 10 ms).
function Update-ClickCapture {
    param($Form)
    $st = $Form.Tag
    if ($Form.IsDisposed) { $st.Poll.Stop(); return }
    if ([Environment]::TickCount - $st.Started -ge 5000) {
        $st.Poll.Stop()
        $st.Status.Text = 'No click recorded; timed out.'
        return
    }
    $button = Get-PressedMouseButton
    if ($st.WaitingForRelease) {
        if (-not $button) { $st.WaitingForRelease = $false }
        return
    }
    if (-not $button) { return }
    $p = Get-MousePosition
    $st.X = $p.X; $st.Y = $p.Y; $st.Button = $button; $st.Captured = $true
    $st.Poll.Stop()
    $st.Status.Text = "Captured $button click at $($p.X), $($p.Y)."
}

# The Schedule button: hides the form and replays the recorded click later.
function Invoke-DelayedClickSchedule {
    param($Form)
    $st = $Form.Tag
    $delay = $st.DelayBox.Text.Trim()
    if (-not $st.Captured -or $delay -notmatch '^\d+$') {
        Show-MessageBox 'Record a click and enter a delay in milliseconds.' 'Invalid input'
        return
    }
    $st.PendingX = $st.X; $st.PendingY = $st.Y; $st.PendingButton = $st.Button
    $Form.Hide()
    Start-PendingTimer $Form $delay { param($sender, $e) $sender.Stop(); Send-PendingClick $sender.Tag }
}

function Send-PendingClick {
    param($Form)
    $st = $Form.Tag
    try { Send-Click $st.PendingX $st.PendingY $st.PendingButton }
    catch { Show-MessageBox $_.Exception.Message 'Delayed click failed' }
}

function ShowDelayedClickForm {
    param($Macro)
    $form = New-DelayedClickForm
    $form.Show()
    $form.Activate()
}
