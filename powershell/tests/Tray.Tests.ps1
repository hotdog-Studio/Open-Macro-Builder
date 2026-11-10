BeforeAll { . "$PSScriptRoot\..\lib\Tray.ps1"; $log = Join-Path $env:TEMP "macropad-log-test-$PID.log" }
Describe 'Write-MacropadLog' {
    AfterEach { Remove-Item $log, "$log.old" -ErrorAction SilentlyContinue }
    It 'appends a timestamped line' {
        Write-MacropadLog 'one' $log; Write-MacropadLog 'two' $log
        $lines = @(Get-Content $log); $lines.Count | Should -Be 2; $lines[1] | Should -Match '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d two$'
    }
    It 'starts a new file once the log passes its size limit, keeping one old file' {
        Set-Content $log ('x' * 2000)
        Write-MacropadLog 'fresh' $log -MaxBytes 1000
        Get-Content "$log.old" | Should -Be ('x' * 2000)
        $lines = @(Get-Content $log); $lines.Count | Should -Be 1; $lines[0] | Should -Match ' fresh$'
    }
}
