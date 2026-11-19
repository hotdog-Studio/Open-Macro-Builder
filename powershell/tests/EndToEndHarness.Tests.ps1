# Parts of the end-to-end test's harness (helpers\EndToEnd.ps1) that need no desktop.
#
# How the test reads a log that another process is writing (Read-E2eLog), and how the test's own
# commands for the PowerShell macropad write one (E2eWrite in ahk\tests\e2e\commands.ps1). The test
# reads these files many times a second while a macropad or a stand-in writes them, so a read and a
# write fall on the same moment sooner or later. Both sides open the file sharing reading and writing,
# so neither is refused. The AutoHotkey writers (commands.ahk, standin.ahk) open the file the same way;
# only the end-to-end test runs them.
#
# How a wait counts its limit (Wait-E2eCondition), and which waits a run lists at its end as having
# come close to theirs (Add-E2eSlowWait).
#
# These are unit tests on files in TestDrive: they show no window and press no key, so they run in the
# normal suite, not under the EndToEnd tag. None of them measures time or races a clock: a rule about
# how long something took is handed its numbers, and a wait is handed its looks. A test that lives
# through real time passes on a fast machine and fails on a slow one.
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

    It 'E2eWrite leaves the file free: the test reads it at the first look, with no garbage collection in between' {
        E2eWrite (Split-Path $script:Log -Leaf) 'three'
        Mock Wait-Pump { }
        (Read-E2eLog $script:Log) -join '|' | Should -Be 'one|two|three'
        Should -Invoke Wait-Pump -Times 0 -Exactly
    }

    It 'waits with the suite''s own wait, for 300 ms, for a writer that does not share reading, and reads when it lets go' {
        # As Add-Content of Windows PowerShell 5.1 has a file open: reading and writing, sharing writing.
        $script:Held = [System.IO.FileStream]::new($script:Log, 'Open', 'ReadWrite', 'Write')
        # The wait with its clock taken out: one look, the writer lets go, one more look.
        Mock Wait-E2eCondition { $first = & $Condition; if ($null -ne $first) { return $first }; $script:Held.Dispose(); & $Condition }
        (Read-E2eLog $script:Log) -join '|' | Should -Be 'one|two'
        Should -Invoke Wait-E2eCondition -Times 1 -Exactly -ParameterFilter { $TimeoutMs -eq 300 }
    }

    It 'fails, naming the file and what refuses it, when the wait runs out with the file still held' {
        $script:Held = [System.IO.FileStream]::new($script:Log, 'Open', 'ReadWrite', 'Write')
        # The wait with its clock taken out: one look, and the limit has passed.
        Mock Wait-E2eCondition { [void](& $Condition); $null }
        { Read-E2eLog $script:Log } | Should -Throw -ExpectedMessage "The log $($script:Log) could not be opened for reading for 300 ms*being used by another process*does not share reading*"
    }
}

Describe 'End-to-end waits: the limit is time spent waiting, not the time a look takes' {
    BeforeEach { $script:Looks = 0 }

    It 'looks again after a first look that took longer than the whole limit' {
        # The look sleeps for longer than the limit, so this holds however slow the machine is.
        $met = Wait-E2eCondition { $script:Looks++; if ($script:Looks -eq 1) { [System.Threading.Thread]::Sleep(60); $null } else { 'second look' } } -TimeoutMs 30 -EveryMs 1
        $met | Should -Be 'second look'
    }

    It 'gives $null when the condition is never met, having looked more than once' {
        Wait-E2eCondition { $script:Looks++; $false } -TimeoutMs 30 -EveryMs 1 | Should -BeNullOrEmpty
        $script:Looks | Should -BeGreaterThan 1
    }
}

Describe 'End-to-end waits: one that was met close to its limit is noted for the run''s list' {
    BeforeEach {
        $script:E2eRun = [pscustomobject]@{ Deadline = [DateTime]::MaxValue; LimitMinutes = 20; Case = 'ahk SomeCase'; SlowWaits = [System.Collections.Generic.List[string]]::new() }
        # Stands where Wait-E2eCondition stands when it notes a wait: between the rule and who asked.
        function Invoke-E2eNote { param([long]$Ms, [int]$TimeoutMs) Add-E2eSlowWait $Ms $TimeoutMs }
    }
    AfterEach { $script:E2eRun = $null }

    It 'notes nothing for <Ms> ms of <Limit> ms: <Why>' -ForEach @(
        @{ Ms = 0; Limit = 1000; Why = 'met at the first look' }
        @{ Ms = 666; Limit = 1000; Why = 'under two thirds' }
        @{ Ms = 1999; Limit = 3000; Why = 'under two thirds' }
        @{ Ms = 999; Limit = 999; Why = 'a limit under a second is a step of a longer wait' }
    ) {
        Invoke-E2eNote $Ms $Limit
        $script:E2eRun.SlowWaits.Count | Should -Be 0
    }

    It 'notes <Ms> ms of <Limit> ms, with the case and where the wait was asked for' -ForEach @(
        @{ Ms = 667; Limit = 1000 }
        @{ Ms = 2000; Limit = 3000 }
        @{ Ms = 9400; Limit = 10000 }
    ) {
        Invoke-E2eNote $Ms $Limit
        $script:E2eRun.SlowWaits.Count | Should -Be 1
        $script:E2eRun.SlowWaits[0] | Should -Match "^ahk SomeCase: $Ms ms of $Limit ms at EndToEndHarness\.Tests\.ps1:\d+"
    }

    It 'notes nothing outside a run' {
        $script:E2eRun = $null
        { Invoke-E2eNote 900 1000 } | Should -Not -Throw
    }

    It 'is asked by a wait that is met, with the wait''s own limit' {
        Mock Add-E2eSlowWait { }
        Wait-E2eCondition { $true } -TimeoutMs 4321 | Should -BeTrue
        Should -Invoke Add-E2eSlowWait -Times 1 -Exactly -ParameterFilter { $TimeoutMs -eq 4321 }
    }

    It 'is not asked by a wait that is not met: that one fails its case, or is meant to run out' {
        Mock Add-E2eSlowWait { }
        Wait-E2eCondition { $false } -TimeoutMs 30 -EveryMs 1 | Should -BeNullOrEmpty
        Should -Invoke Add-E2eSlowWait -Times 0 -Exactly
    }
}
