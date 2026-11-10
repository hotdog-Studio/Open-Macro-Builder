BeforeAll {
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'WinTitle', 'WindowOps') { . "$PSScriptRoot\..\lib\$f.ps1" }
    function New-TestForm {
        $f = New-Object System.Windows.Forms.Form; $f.Text = "MacropadOpsTest $PID"; $f.StartPosition = 'Manual'; $f.Location = '100,100'; $f.Size = '400,300'
        $tb = New-Object System.Windows.Forms.TextBox; $f.Controls.Add($tb)
        $p = New-Object System.Windows.Forms.Panel; $p.Location = '10,50'; $p.Size = '100,100'; $p.Tag = @{ Downs = 0 }
        $p.add_MouseDown({ param($sender, $e) $sender.Tag.Downs++ }); $f.Controls.Add($p)
        $f.Show(); Wait-Pump 50
        @{ Form = $f; TextBox = $tb; Panel = $p; Title = "MacropadOpsTest $PID" }
    }
}
Describe 'window actions' {
    BeforeEach { $t = New-TestForm }
    AfterEach { $t.Form.Dispose() }
    It 'moves and measures a window' {
        Move-Window $t.Title 200 210 500 400; $r = Get-WindowRect $t.Title
        $r.X | Should -Be 200; $r.Y | Should -Be 210; $r.Width | Should -Be 500; $r.Height | Should -Be 400
    }
    It 'keeps omitted dimensions' { Move-Window $t.Title -X 150; (Get-WindowRect $t.Title).Width | Should -Be 400 }
    It 'minimizes and restores' { Set-WindowState $t.Title Minimize; Get-WindowState $t.Title | Should -Be 'Minimized'; Set-WindowState $t.Title Restore; Get-WindowState $t.Title | Should -Be 'Normal' }
    It 'sets topmost' { Set-WindowTopmost $t.Title; (Get-WindowStyle $t.Title -Ex) -band 0x8 | Should -Be 0x8 }
    It 'sets transparency' { Set-WindowTransparency $t.Title -Alpha 128; (Get-WindowStyle $t.Title -Ex) -band 0x80000 | Should -Be 0x80000 }
    It 'removes a style bit' { Set-WindowStyle $t.Title 0x10000 Remove; (Get-WindowStyle $t.Title) -band 0x10000 | Should -Be 0 }
    It 'throws for a missing window' { { Move-Window 'NoSuchWindow-xyz' 0 0 } | Should -Throw "Window not found: 'NoSuchWindow-xyz'" }
    It 'closes a window' { Close-Window $t.Title | Should -BeTrue; Find-Window $t.Title | Should -Be ([IntPtr]::Zero) }
}
Describe 'controls' {
    BeforeEach { $t = New-TestForm }
    AfterEach { $t.Form.Dispose() }
    It 'finds a control by ClassNN' { Find-Control $t.Title ("{0}1" -f [Macropad.WindowApi]::ClassName($t.TextBox.Handle)) | Should -Be $t.TextBox.Handle }
    It 'sets and gets control text' { Set-ControlText $t.TextBox.Handle 'abc'; Get-ControlText $t.TextBox.Handle | Should -Be 'abc' }
    It 'sends characters to a control' { Send-ControlKeys $t.TextBox.Handle 'hi'; Wait-Pump 50; $t.TextBox.Text | Should -Be 'hi' }
    It 'clicks a control' { Invoke-ControlClick $t.Panel.Handle; Wait-Pump 50; $t.Panel.Tag.Downs | Should -Be 1 }
    It 'throws for a missing control' { { Find-Control $t.Title 'Nope1' } | Should -Throw "Control not found: 'Nope1'" }
}
Describe 'waits' {
    It 'returns a window once it appears' {
        $script:waitTimer = New-Object System.Windows.Forms.Timer; $script:waitTimer.Interval = 100; $script:waitTimer.Tag = "MacropadWaitTest $PID"
        $script:waitTimer.add_Tick({ param($sender, $e) $sender.Stop(); $script:waitForm = New-Object System.Windows.Forms.Form; $script:waitForm.Text = $sender.Tag; $script:waitForm.Show() })
        $script:waitTimer.Start()
        # Assign first: Should's argument would be bound before Wait-Window runs, while the form is still null.
        $found = Wait-Window "MacropadWaitTest $PID" -TimeoutMs 3000
        $found | Should -Be $script:waitForm.Handle
        $script:waitForm.Dispose(); $script:waitTimer.Dispose()
    }
    It 'returns zero after the timeout' { Wait-Window 'NoSuchWindow-xyz' -TimeoutMs 120 | Should -Be ([IntPtr]::Zero) }
    It 'reports an absent window as closed' { Wait-WindowClose 'NoSuchWindow-xyz' -TimeoutMs 100 | Should -BeTrue }
}
Describe 'Switch-Window' -Tag Integration {
    It 'activates a window by WinTitle' {
        $a = New-Object System.Windows.Forms.Form; $a.Text = "MacropadSwitchA $PID"; $a.Show()
        $b = New-Object System.Windows.Forms.Form; $b.Text = "MacropadSwitchB $PID"; $b.Show(); Wait-Pump 50
        try { Switch-Window "MacropadSwitchA $PID" | Should -BeTrue; [Macropad.WindowApi]::Foreground() | Should -Be $a.Handle }
        finally { $a.Dispose(); $b.Dispose() }
    }
}
