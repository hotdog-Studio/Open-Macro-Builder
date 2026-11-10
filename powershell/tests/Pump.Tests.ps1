BeforeAll { . "$PSScriptRoot\..\lib\Native.ps1"; . "$PSScriptRoot\..\lib\Pump.ps1" }
Describe 'Wait-Pump' {
    AfterEach { $global:MacropadExiting = $false }
    It 'waits at least the requested time' {
        $sw = [Diagnostics.Stopwatch]::StartNew(); Wait-Pump 120
        $sw.ElapsedMilliseconds | Should -BeGreaterOrEqual 120
    }
    It 'dispatches WinForms timer ticks while waiting' {
        $t = New-Object System.Windows.Forms.Timer; $t.Interval = 10; $t.Tag = @{ Ticks = 0 }
        $t.add_Tick({ param($sender, $e) $sender.Tag.Ticks++ })
        $t.Start(); Wait-Pump 150; $t.Stop(); $t.Dispose()
        $t.Tag.Ticks | Should -BeGreaterThan 0
    }
    It 'throws when the macropad is exiting' {
        $global:MacropadExiting = $true
        { Wait-Pump 1000 } | Should -Throw -ExceptionType ([OperationCanceledException])
    }
}
