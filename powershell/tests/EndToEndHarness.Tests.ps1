# Parts of the end-to-end test's harness (helpers\EndToEnd.ps1) that need no desktop.
#
# How the test reads a log that another process is writing (Read-E2eLog), and how the test's own
# commands for the PowerShell macropad write one (E2eWrite in ahk\tests\e2e\commands.ps1). The test
# reads these files many times a second while a macropad or a stand-in writes them, so a read and a
# write fall on the same moment sooner or later. Both sides open the file sharing reading and writing,
# so neither is refused. The AutoHotkey writers (commands.ahk, standin.ahk) open the file the same way;
# only the end-to-end test runs them.
#
# How the test reads the macropads' command log (what the command of a press came to: never started,
# not finished, done or failed), what a case says from it, and that the lines the PowerShell engine
# writes are the ones the test reads (the AutoHotkey macropad's are read by the end-to-end test itself,
# which waits for them before every case can run).
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

Describe 'End-to-end command log: what the macropad says of the commands its keys ran' {
    BeforeAll {
        . "$root\powershell\lib\Engine.ps1"
        function E2eHarnessAct { param($m) }
    }
    BeforeEach {
        $script:E2eRun = [pscustomobject]@{ Dir = $TestDrive; Deadline = [DateTime]::MaxValue; LimitMinutes = 20; Case = 'ps SomeCase'; SlowWaits = [System.Collections.Generic.List[string]]::new() }
        $script:CommandLog = Join-Path $TestDrive 'commands.log'
        Remove-Item -LiteralPath $script:CommandLog -ErrorAction SilentlyContinue
    }
    AfterEach { $script:E2eRun = $null }

    It 'reads the line ''<Line>''' -ForEach @(
        @{ Line = 'start E2eStep'; Kind = 'start'; Command = 'E2eStep'; Message = '' }
        @{ Line = 'done Two Words'; Kind = 'done'; Command = 'Two Words'; Message = '' }
        @{ Line = 'failed ChromeNewTab: boom: and more'; Kind = 'failed'; Command = 'ChromeNewTab'; Message = 'boom: and more' }
    ) {
        $l = ConvertFrom-E2eCommandLine $Line
        "$($l.Kind)|$($l.Command)|$($l.Message)" | Should -BeExactly "$Kind|$Command|$Message"
    }

    It 'reads no line of another form: ''<Line>''' -ForEach @(@{ Line = '' }, @{ Line = 'started E2eStep' }, @{ Line = 'done' }) {
        ConvertFrom-E2eCommandLine $Line | Should -BeNullOrEmpty
    }

    It 'says <State> for run <Run> of <Command> after <Lines>' -ForEach @(
        @{ Lines = @(); Command = 'A'; Run = 1; State = 'not started'; Message = '' }
        @{ Lines = @('start B', 'done B'); Command = 'A'; Run = 1; State = 'not started'; Message = '' }
        @{ Lines = @('start A'); Command = 'A'; Run = 1; State = 'running'; Message = '' }
        @{ Lines = @('start A', 'done A'); Command = 'A'; Run = 1; State = 'done'; Message = '' }
        @{ Lines = @('start A', 'failed A: boom'); Command = 'A'; Run = 1; State = 'failed'; Message = 'boom' }
        # Another key's command that interrupted A (AutoHotkey runs it in a thread of its own).
        @{ Lines = @('start A', 'start B', 'done B', 'done A'); Command = 'A'; Run = 1; State = 'done'; Message = '' }
        @{ Lines = @('start A', 'start B', 'done B', 'done A'); Command = 'B'; Run = 1; State = 'done'; Message = '' }
        @{ Lines = @('start A', 'start B', 'done B'); Command = 'A'; Run = 1; State = 'running'; Message = '' }
        @{ Lines = @('start A', 'done A', 'start A'); Command = 'A'; Run = 2; State = 'running'; Message = '' }
        @{ Lines = @('start A', 'done A', 'start A', 'failed A: second'); Command = 'A'; Run = 2; State = 'failed'; Message = 'second' }
        @{ Lines = @('start A', 'done A'); Command = 'A'; Run = 2; State = 'not started'; Message = '' }
    ) {
        $s = Get-E2eCommandState $Lines $Command $Run
        "$($s.State)|$($s.Message)" | Should -BeExactly "$State|$Message"
    }

    It 'puts <State> in words, with the lines it read' -ForEach @(
        @{ State = 'not started'; Message = ''; Lines = @(); Want = 'the macropad never started E2eStep (it did not take the key, or dropped it while another command ran) (the command log since the press: nothing)' }
        @{ State = 'running'; Message = ''; Lines = @('start E2eStep'); Want = 'the macropad started E2eStep, and it has not finished (the command log since the press: start E2eStep)' }
        @{ State = 'done'; Message = ''; Lines = @('start E2eStep', 'done E2eStep'); Want = 'the macropad ran E2eStep to its end, so what is missing is what the command did, not its run (the command log since the press: start E2eStep / done E2eStep)' }
        @{ State = 'failed'; Message = 'boom'; Lines = @('start E2eStep', 'failed E2eStep: boom'); Want = 'E2eStep failed: boom (the command log since the press: start E2eStep / failed E2eStep: boom)' }
    ) {
        Get-E2eCommandText ([pscustomobject]@{ State = $State; Message = $Message }) 'E2eStep' $Lines | Should -BeExactly $Want
    }

    It 'reads only the lines written after a mark' {
        [System.IO.File]::WriteAllText($script:CommandLog, "start E2eMark`ndone E2eMark`n")
        $mark = Get-E2eCommandMark
        [System.IO.File]::AppendAllText($script:CommandLog, "start E2eStep`n")
        $mark | Should -Be 2
        Get-E2eCommandLines $mark | Should -Be @('start E2eStep')
        @(Get-E2eCommandLines 0).Count | Should -Be 3
    }

    It 'gives nothing, and a mark of 0, before the macropad has written the log' {
        Get-E2eCommandMark | Should -Be 0
        @(Get-E2eCommandLines 0).Count | Should -Be 0
    }

    It 'returns the state of a command that finished, with the lines after the mark' {
        [System.IO.File]::WriteAllText($script:CommandLog, "start E2eMark`ndone E2eMark`nstart E2eStep`ndone E2eStep`n")
        $s = Assert-E2eCommandDone 2 'E2eStep' -TimeoutMs 1000
        $s.State | Should -Be 'done'
        $s.Lines | Should -Be @('start E2eStep', 'done E2eStep')
    }

    It 'fails, saying what the log says, when the command <Why>' -ForEach @(
        @{ Text = ''; Why = 'never started'; Want = 'Waited 1000 ms for E2eStep to finish: the macropad never started E2eStep*(the command log since the press: nothing)' }
        @{ Text = "start E2eStep`n"; Why = 'did not finish'; Want = 'Waited 1000 ms for E2eStep to finish: the macropad started E2eStep, and it has not finished*' }
        @{ Text = "start E2eStep`nfailed E2eStep: boom`n"; Why = 'failed'; Want = 'Waited 1000 ms for E2eStep to finish: E2eStep failed: boom*' }
    ) {
        if ($Text) { [System.IO.File]::WriteAllText($script:CommandLog, $Text) }
        # The wait with its clock taken out: one look, and the limit has passed (unless it was met).
        Mock Wait-E2eCondition { & $Condition }
        { Assert-E2eCommandDone 0 'E2eStep' -TimeoutMs 1000 } | Should -Throw -ExpectedMessage $Want
    }

    It 'reads the lines the PowerShell macropad''s engine writes, for a command that finished and one that failed' {
        $engine = [pscustomobject]@{ Busy = $false; CommandLog = $script:CommandLog; RunMacro = { param($m) Invoke-Macro $m }; OnError = { param($m, $e) } }
        [void](Invoke-EngineMacro $engine ([pscustomobject]@{ Action = 'E2eHarnessAct'; Name = 'its name' }))
        [void](Invoke-EngineMacro $engine ([pscustomobject]@{ Action = { throw "it broke`nhere" }; Name = 'Broken' }))
        $lines = Get-E2eCommandLines 0
        (Get-E2eCommandState $lines 'E2eHarnessAct').State | Should -Be 'done'
        $s = Get-E2eCommandState $lines 'Broken'
        "$($s.State)|$($s.Message)" | Should -BeExactly 'failed|it broke here'
    }

    It 'adds to a failure after the press what the log says of the case''s command' {
        [System.IO.File]::WriteAllText($script:CommandLog, "start E2eMark`ndone E2eMark`nstart E2eStep`n")
        $ctx = @{ Case = @{ Command = 'E2eStep' }; Pressed = $true; Commands = 2 }
        Get-E2eFailureText 'Expected B in front.' $ctx | Should -BeExactly "Expected B in front.`nWhat the macropad's command log says of E2eStep: the macropad started E2eStep, and it has not finished (the command log since the press: start E2eStep)"
    }

    It 'leaves a failure as it is when <Why>' -ForEach @(
        @{ Pressed = $false; Message = 'Not pressed: B was not in front.'; Why = 'nothing was pressed' }
        @{ Pressed = $true; Message = 'Waited 1000 ms for E2eStep to finish: E2eStep failed: boom (the command log since the press: start E2eStep / failed E2eStep: boom)'; Why = 'it says what the log says already' }
    ) {
        $ctx = @{ Case = @{ Command = 'E2eStep' }; Pressed = $Pressed; Commands = 0 }
        Get-E2eFailureText $Message $ctx | Should -BeExactly $Message
    }

    It 'gives the macropad under test OMB_E2E, which turns its command log on, and the run''s folder' {
        $envs = Get-E2eMacropadEnvironment
        $envs.OMB_E2E | Should -Be '1'
        $envs.OMB_E2E_DIR | Should -Be $TestDrive
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
