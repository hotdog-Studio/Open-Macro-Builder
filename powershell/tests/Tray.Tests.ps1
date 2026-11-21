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
    It 'appends while another program has the log open for reading and writing' {
        Set-Content $log 'first'
        $other = [System.IO.FileStream]::new($log, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::ReadWrite)
        try { Write-MacropadLog 'second' $log } finally { $other.Dispose() }
        $lines = @(Get-Content $log); $lines.Count | Should -Be 2; $lines[1] | Should -Match ' second$'
    }
    It 'appends while another program is reading the log' {
        Set-Content $log 'first'
        $reader = [System.IO.FileStream]::new($log, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try { Write-MacropadLog 'second' $log } finally { $reader.Dispose() }
        $lines = @(Get-Content $log); $lines.Count | Should -Be 2; $lines[1] | Should -Match ' second$'
    }
    It 'drops the line without an error when the file cannot be written' {
        Set-Content $log 'first'
        $locked = [System.IO.FileStream]::new($log, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        try { { Write-MacropadLog 'second' $log } | Should -Not -Throw } finally { $locked.Dispose() }
        @(Get-Content $log) | Should -Be @('first')
    }
    It 'drops the line without an error when the folder does not exist' {
        { Write-MacropadLog 'lost' (Join-Path $env:TEMP "no-such-folder-$PID\macropad.log") } | Should -Not -Throw
    }
    It 'still writes the line when the full log cannot be renamed' {
        Set-Content $log ('x' * 2000)
        $reader = [System.IO.FileStream]::new($log, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try { { Write-MacropadLog 'fresh' $log -MaxBytes 1000 } | Should -Not -Throw } finally { $reader.Dispose() }
        @(Get-Content $log)[-1] | Should -Match ' fresh$'
    }
}
