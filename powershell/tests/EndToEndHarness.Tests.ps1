# Two parts of the end-to-end test's harness (helpers\EndToEnd.ps1) that need no desktop.
#
# How the test reads a log that another process is writing (Read-E2eLog), and how the test's own
# commands for the PowerShell macropad write one (E2eWrite in ahk\tests\e2e\commands.ps1). The test
# reads these files many times a second while a macropad or a stand-in writes them, so a read and a
# write fall on the same moment sooner or later. Both sides open the file sharing reading and writing,
# so neither is refused. The AutoHotkey writers (commands.ahk, standin.ahk) open the file the same way;
# only the end-to-end test runs them.
#
# And which waits a run lists at its end as having come close to their limit (Add-E2eSlowWait).
#
# These are unit tests on files in TestDrive: they show no window and press no key, so they run in the
# normal suite, not under the EndToEnd tag.
BeforeAll {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'WinTitle', 'WindowOps', 'Window') { . "$root\powershell\lib\$f.ps1" }
    . "$PSScriptRoot\helpers\Ahk.ps1"
    . "$PSScriptRoot\helpers\CommandSource.ps1"
    . "$PSScriptRoot\helpers\EndToEnd.ps1"
    . "$root\ahk\tests\e2e\commands.ps1"
}

Describe 'End-to-end logs: the test reads a file while another process writes it' {
    BeforeEach {
        $script:Log = Join-Path $TestDrive "log-$(Get-Random).log"
        [System.IO.File]::WriteAllText($script:Log, "one`ntwo`n")
        $script:Held = $null
        $script:DirBefore = $env:OMB_E2E_DIR
        $env:OMB_E2E_DIR = $TestDrive
    }
    AfterEach {
        if ($script:Held) { $script:Held.Dispose() }
        $env:OMB_E2E_DIR = $script:DirBefore
    }

    It 'gives no lines for a file that does not exist yet' {
        @(Read-E2eLog (Join-Path $TestDrive 'none.log')).Count | Should -Be 0
    }

    It 'reads beside a writer that has the file open as the test''s commands and the stand-in open it' {
        $script:Held = [System.IO.FileStream]::new($script:Log, 'Append', 'Write', 'ReadWrite')
        (Read-E2eLog $script:Log) -join '|' | Should -Be 'one|two'
    }

    It 'reads beside a writer that shares only reading, as the launcher''s File.AppendAllText does' {
        $script:Held = [System.IO.FileStream]::new($script:Log, 'Append', 'Write', 'Read')
        (Read-E2eLog $script:Log) -join '|' | Should -Be 'one|two'
    }

    It 'E2eWrite writes its line while the test has the file open to read it' {
        # As Read-E2eLog opens it. Add-Content is refused here, and that lost the line in the CI run.
        $script:Held = [System.IO.FileStream]::new($script:Log, 'Open', 'Read', 'ReadWrite')
        E2eWrite (Split-Path $script:Log -Leaf) 'three'
        $script:Held.Dispose(); $script:Held = $null
        (Read-E2eLog $script:Log) -join '|' | Should -Be 'one|two|three'
    }

    It 'E2eWrite leaves the file free: the test reads it at once, with no garbage collection in between' {
        E2eWrite (Split-Path $script:Log -Leaf) 'three'
        Mock Wait-Pump { }
        (Read-E2eLog $script:Log) -join '|' | Should -Be 'one|two|three'
        Should -Invoke Wait-Pump -Times 0 -Exactly
    }

    It 'waits with the suite''s own wait for a writer that does not share reading, and reads when it lets go' {
        # As Add-Content of Windows PowerShell 5.1 has a file open: reading and writing, sharing writing.
        $script:Held = [System.IO.FileStream]::new($script:Log, 'Open', 'ReadWrite', 'Write')
        Mock Wait-Pump { $script:Held.Dispose() }
        (Read-E2eLog $script:Log) -join '|' | Should -Be 'one|two'
        Should -Invoke Wait-Pump -Times 1 -Exactly
    }

    It 'fails, naming the file and what refuses it, when such a writer keeps the file' {
        $script:Held = [System.IO.FileStream]::new($script:Log, 'Open', 'ReadWrite', 'Write')
        { Read-E2eLog $script:Log } | Should -Throw -ExpectedMessage "The log $($script:Log) could not be opened for reading for 300 ms*being used by another process*does not share reading*"
    }
}

Describe 'End-to-end waits: one that was met close to its limit is noted for the run''s list' {
    BeforeEach {
        $script:E2eRun = [pscustomobject]@{ Deadline = [DateTime]::MaxValue; LimitMinutes = 20; Case = 'ahk SomeCase'; SlowWaits = [System.Collections.Generic.List[string]]::new() }
        $script:Clock = [System.Diagnostics.Stopwatch]::StartNew()
    }
    AfterEach { $script:E2eRun = $null }

    It 'notes nothing for a wait that is met early' {
        Wait-E2eCondition { $true } -TimeoutMs 1000 | Should -BeTrue
        $script:E2eRun.SlowWaits.Count | Should -Be 0
    }

    It 'notes a wait that is met after two thirds of its limit, with the case, both times and where it was asked for' {
        Wait-E2eCondition { $script:Clock.ElapsedMilliseconds -ge 700 } -TimeoutMs 1000 -EveryMs 10 | Should -BeTrue
        $script:E2eRun.SlowWaits.Count | Should -Be 1
        $script:E2eRun.SlowWaits[0] | Should -Match '^ahk SomeCase: \d+ ms of 1000 ms at EndToEndHarness\.Tests\.ps1:\d+'
    }

    It 'notes nothing for a wait that is not met: that one fails its case, or is meant to run out' {
        Wait-E2eCondition { $false } -TimeoutMs 1000 -EveryMs 10 | Should -BeNullOrEmpty
        $script:E2eRun.SlowWaits.Count | Should -Be 0
    }

    It 'notes nothing for a limit under a second: those are the steps of a longer wait' {
        Wait-E2eCondition { $script:Clock.ElapsedMilliseconds -ge 250 } -TimeoutMs 300 -EveryMs 10 | Should -BeTrue
        $script:E2eRun.SlowWaits.Count | Should -Be 0
    }
}
