# Parts of the end-to-end test's harness (helpers\EndToEnd.ps1) that need no desktop.
#
# How the test reads a log that another process is writing (Read-E2eLog), and how the test's own
# commands for the PowerShell macropad write one (E2eWrite in ahk\tests\e2e\commands.ps1). The test
# reads these files many times a second while a macropad or a stand-in writes them, so a read and a
# write fall on the same moment sooner or later. Both sides open the file sharing reading and writing,
# so neither is refused. The AutoHotkey writers (commands.ahk, standin.ahk) open the file the same way;
# only the end-to-end test runs them.
#
# How the test reads a stand-in's log: a command posted to the window (WM_COMMAND, as
# ChromeNewTabInGroup posts one) is an event of its own, not a key.
#
# How the test reads the macropads' command log (what the command of a press came to: never started,
# not finished, done or failed), what a case says from it, and that the lines the PowerShell engine
# writes are the ones the test reads (the AutoHotkey macropad's are read by the end-to-end test itself,
# which waits for them before every case can run).
#
# How a wait counts its limit (Wait-E2eCondition), and which waits a run lists at its end as having
# come close to theirs (Add-E2eSlowWait).
#
# What a failed case says of the keyboard and the desktop (Get-E2eFailureState): the key watch's record
# as one line, on a record made up in the key watch's own form, and how a NextWindow press's Alt+Tab went
# out (Get-E2eChordTimes).
#
# How the test writes its layouts (the example layout's display options, and a second layer for a layout
# that fills one), and where on the screen it finds a key's label or icon on an overlay drawn from one
# (ConvertTo-E2eOverlayPoint, handed the rectangles a drawn overlay would have).
#
# Where the cases that press the layout file's hotkeys and type its hotstrings go (a layout of their own,
# the only one with "hotkeys" and "hotstrings"), the keys a hotstring is typed with, what E2eHotkey
# writes, and the text a stand-in holds after the key events it received (ConvertTo-E2eTypedText).
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

Describe 'End-to-end stand-in log: what reached a stand-in window' {
    It 'reads a command line (a WM_COMMAND posted to the window) as a command with its number, and not as a key' {
        $standin = [pscustomobject]@{ Log = (Join-Path $TestDrive 'standin-A.log') }
        [System.IO.File]::WriteAllText($standin.Log, "start A pid=1 hwnd=2`ncommand 35024`ndown vk=41 sc=01E repeat=0 mods=-`nup vk=41 sc=01E repeat=0 mods=-`n")
        $events = @(Get-E2eStandinEvents $standin 1)
        ($events | ForEach-Object { $_.Kind }) -join ',' | Should -Be 'command,down,up'
        $events[0].Id | Should -Be 35024
        @(Get-E2eStandinTaps $standin 1).Count | Should -Be 1 -Because 'the key is one tap, and the command is none'
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

    # A case fails on a failed line after its mark, but only on one of its own command or of E2eMark: the command
    # an earlier case ran may end, and fail, after this case's mark.
    It 'takes as the case''s failures <Want> when the log after the mark is <Lines>' -ForEach @(
        @{ Lines = @('start E2eStep', 'failed Earlier: late', 'done E2eStep'); Want = @() }
        @{ Lines = @('failed Earlier: late'); Want = @() }
        @{ Lines = @('start E2eStep', 'failed E2eStep: boom'); Want = @('failed E2eStep: boom') }
        @{ Lines = @('start E2eMark', 'failed E2eMark: boom', 'start E2eStep', 'done E2eStep'); Want = @('failed E2eMark: boom') }
        @{ Lines = @('failed Earlier: late', 'start E2eStep', 'failed E2eStep: again', 'failed Other: also late'); Want = @('failed E2eStep: again') }
        @{ Lines = @(); Want = @() }
    ) {
        $got = @(Get-E2eCaseFailedLines $Lines 'E2eStep')
        ($got -join ' / ') | Should -BeExactly ($Want -join ' / ')
    }

    # The checks Invoke-E2eCase runs after a case's own assertions, through the logs the macropad writes.
    It 'fails a case on <Why>' -ForEach @(
        @{ Log = "start E2eStep`nfailed E2eStep: boom`n"; Errors = ''; Want = '*no command the case ran may fail*failed E2eStep: boom*'; Why = 'a failed line of its own command' }
        @{ Log = "start E2eMark`nfailed E2eMark: boom`n"; Errors = ''; Want = '*no command the case ran may fail*failed E2eMark: boom*'; Why = 'a failed line of E2eMark' }
        @{ Log = "start E2eStep`ndone E2eStep`n"; Errors = "Error: it broke`n"; Want = '*the macropad must not report an error*it broke*'; Why = 'an error the macropad reported' }
    ) {
        [System.IO.File]::WriteAllText($script:CommandLog, "start E2eMark`ndone E2eMark`n$Log")
        if ($Errors) { [System.IO.File]::WriteAllText((Join-Path $TestDrive 'errors.log'), $Errors) }
        $ctx = @{ Case = @{ Command = 'E2eStep' }; Commands = 2 }
        try { { Assert-E2eCaseLogs $ctx 0 } | Should -Throw -ExpectedMessage $Want }
        finally { Remove-Item -LiteralPath (Join-Path $TestDrive 'errors.log') -ErrorAction SilentlyContinue }
    }

    It 'passes a case whose log after the press holds only a late failed line of the command an earlier case ran' {
        [System.IO.File]::WriteAllText($script:CommandLog, "start E2eMark`ndone E2eMark`nstart E2eStep`nfailed Earlier: late`ndone E2eStep`n")
        $ctx = @{ Case = @{ Command = 'E2eStep' }; Commands = 2 }
        { Assert-E2eCaseLogs $ctx 0 } | Should -Not -Throw
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

Describe 'End-to-end layouts: the overlay is drawn as the example layout draws it' {
    BeforeAll {
        foreach ($f in 'Assets', 'Model', 'ConfigJson') { . "$root\powershell\lib\$f.ps1" }
        $script:Shown = [pscustomobject]@{ showFn = ' '; showMacroMarkers = $true; showLabels = $true; useMacroIcons = $false; iconAction = 'Layer' }
        # A layout file of Count slots as the test writes it, and its path.
        function Write-TestLayout {
            param([int]$Count, $Options = $script:Shown)
            $path = Join-Path $TestDrive "layout-$Count-$(Get-Random).json"
            $slots = @(for ($i = 0; $i -lt $Count; $i++) { @{ action = "E2eCase$i"; name = "E2eCase$i"; description = '' } })
            Write-E2eLayoutFile $slots $path $Options
            $path
        }
        # The controls of an overlay drawn from Layout at Scale, its client area at 100, 200: each key's
        # label and icon, and the Fn key's, at their rounded places (Windows places each control on whole
        # pixels).
        function Get-TestControls {
            param($Layout, [double]$Scale, [switch]$NoFn)
            $s = { param($v) [int][math]::Round($v * $Scale) }
            $keys = @($Layout.Keys) + @(if (-not $NoFn) { $Layout.Fn })
            , @(foreach ($k in $keys) {
                    , @((100 + (& $s $k.Label.X)), (200 + (& $s $k.Label.Y)), (& $s $k.Label.W), (& $s $k.Label.H))
                    , @((100 + (& $s $k.X)), (200 + (& $s $k.Y)), (& $s $k.W), (& $s $k.H))
                })
        }
    }

    It 'reads the five display options of config.json as the file gives them' {
        $want = [System.IO.File]::ReadAllText((Join-Path $root 'config.json')) | ConvertFrom-Json
        $got = Get-E2eLayoutOptions
        @($got.PSObject.Properties.Name) -join ',' | Should -Be 'showFn,showMacroMarkers,showLabels,useMacroIcons,iconAction'
        foreach ($name in 'showFn', 'showMacroMarkers', 'showLabels', 'useMacroIcons', 'iconAction') { $got.$name | Should -BeExactly $want.$name -Because "$name is the example layout's" }
    }

    It 'leaves out an option the file does not have, for the macropad''s own default' {
        $path = Join-Path $TestDrive 'some-options.json'
        [System.IO.File]::WriteAllText($path, '{ "showLabels": true, "iconAction": "Macro" }')
        $got = Get-E2eLayoutOptions $path
        @($got.PSObject.Properties.Name) -join ',' | Should -Be 'showLabels,iconAction'
    }

    It 'writes the example layout''s display options into every layout' {
        $want = Get-E2eLayoutOptions
        $path = Join-Path $TestDrive 'layout-default-options.json'
        Write-E2eLayoutFile @(@{ action = 'E2eCase0'; name = 'E2eCase0'; description = '' }) $path
        $json = [System.IO.File]::ReadAllText($path) | ConvertFrom-Json
        foreach ($name in 'showFn', 'showMacroMarkers', 'showLabels', 'useMacroIcons', 'iconAction') { $json.$name | Should -BeExactly $want.$name -Because "$name is written as config.json has it" }
    }

    It 'writes options that the model of both macropads reads back' {
        $layout = Import-MacropadConfig (Write-TestLayout 3)
        "$($layout.ShowFn)|$($layout.ShowMacroMarkers)|$($layout.ShowLabels)|$($layout.UseMacroIcons)|$($layout.IconAction)" | Should -BeExactly ' |True|True|False|Layer'
    }

    It 'gives a layout of <Count> slots <Layers> layers, the last with <Last> macros' -ForEach @(
        @{ Count = 3; Layers = 2; Last = 0 }
        @{ Count = 11; Layers = 2; Last = 0 }
        @{ Count = 12; Layers = 2; Last = 1 }
        @{ Count = 23; Layers = 3; Last = 1 }
    ) {
        $layout = Import-MacropadConfig (Write-TestLayout $Count)
        # Not named $layers: a variable's name is not case-sensitive, and it would replace the case's $Layers.
        $found = @($layout.Layers)
        $found.Count | Should -Be $Layers
        @($found[-1].Macros).Count | Should -Be $Last
        $found[-1].Title | Should -Be "Test $Layers"
        @($found[0].Macros).Count | Should -Be ([math]::Min($Count, 11))
    }

    It 'finds the middle of the <Part> of key <Slot> at <X>, <Y> when the overlay is drawn at scale <Scale>' -ForEach @(
        @{ Slot = 1; Part = 'Label'; Scale = 1.0; X = 132; Y = 208 }
        @{ Slot = 1; Part = 'Icon'; Scale = 1.0; X = 132; Y = 249 }
        @{ Slot = 6; Part = 'Label'; Scale = 1.0; X = 196; Y = 291 }
        @{ Slot = 6; Part = 'Icon'; Scale = 1.0; X = 196; Y = 332 }
        @{ Slot = 11; Part = 'Icon'; Scale = 1.0; X = 260; Y = 415 }
        @{ Slot = 1; Part = 'Label'; Scale = 1.25; X = 140; Y = 210 }
        @{ Slot = 6; Part = 'Icon'; Scale = 1.25; X = 220; Y = 365 }
        @{ Slot = 6; Part = 'Icon'; Scale = 1.5; X = 244; Y = 398 }
    ) {
        $layout = Import-MacropadConfig (Write-TestLayout 3)
        $p = ConvertTo-E2eOverlayPoint $layout $Slot $Part @(100, 200, 300, 400) (Get-TestControls $layout $Scale)
        "$($p.X), $($p.Y)" | Should -Be "$X, $Y"
        $p.Scale | Should -Be $Scale
    }

    It 'measures the scale on the controls, not on the client area: AutoHotkey''s window is larger than its controls by its margins' {
        $layout = Import-MacropadConfig (Write-TestLayout 3)
        $p = ConvertTo-E2eOverlayPoint $layout 1 'Icon' @(100, 200, 290, 350) (Get-TestControls $layout 1.0)
        "$($p.X), $($p.Y), $($p.Scale)" | Should -Be '132, 249, 1'
    }

    It 'refuses controls that do not fit the layout at one scale, saying how far they reach' {
        # An overlay drawn without the Fn key reaches 256 x 247 px: not the layout's 256 x 330.
        $layout = Import-MacropadConfig (Write-TestLayout 3)
        { ConvertTo-E2eOverlayPoint $layout 1 'Label' @(100, 200, 256, 330) (Get-TestControls $layout 1.0 -NoFn) } |
            Should -Throw -ExpectedMessage "The overlay's 22 controls reach 256 x 247 px from its client origin (100, 200), which is not the layout's 256 x 330 px at one scale*"
    }

    It 'says that there is no label to point at on a layout that shows none' {
        $layout = Import-MacropadConfig (Write-TestLayout 3 ([pscustomobject]@{ showLabels = $false }))
        { ConvertTo-E2eOverlayPoint $layout 1 'Label' @(100, 200, 256, 256) (Get-TestControls $layout 1.0 -NoFn) } |
            Should -Throw -ExpectedMessage 'Key 1 has no label on the overlay: the layout shows no labels.'
    }

    It 'says that the layout has no key <Slot>' -ForEach @(@{ Slot = 0 }, @{ Slot = 12 }) {
        $layout = Import-MacropadConfig (Write-TestLayout 3)
        { ConvertTo-E2eOverlayPoint $layout $Slot 'Icon' @(100, 200, 256, 330) (Get-TestControls $layout 1.0) } | Should -Throw -ExpectedMessage "The layout has no key $Slot; it has 11."
    }
}

# Get-E2eMacropadWindows gives its list as one object (return , @(...)), so that a list of one window
# stays a list and an empty one is not nothing. A caller uses the result as it is: wrapped again in @(...)
# it is a list of one element, the real list, whatever the count. Each helper that asks for the windows is
# called here against a mock that returns the list the way the real function does, with no window, one
# and two. The handles are not windows: Windows answers a question about one with no title, no class, no
# size and no children, so nothing of a desktop is touched (a test that needs a real overlay is an
# end-to-end case).
Describe 'End-to-end windows: the helpers use the macropad''s window list as Get-E2eMacropadWindows gives it' {
    BeforeAll {
        foreach ($f in 'Assets', 'Model', 'ConfigJson') { . "$root\powershell\lib\$f.ps1" }
    }
    BeforeEach {
        # The handles are numbers no window has; $script:Handles is what the mock gives.
        $script:First = [IntPtr]0x0BAD0001
        $script:Second = [IntPtr]0x0BAD0002
        Write-E2eLayoutFile @(@{ action = 'E2eCase0'; name = 'E2eCase0'; description = '' }) (Join-Path $TestDrive 'layout-ps-1.json')
        $script:E2eRun = [pscustomobject]@{ Dir = $TestDrive; Macropad = [pscustomobject]@{ Lang = 'ps'; Chunk = 1 } }
    }
    AfterEach { $script:E2eRun = $null }

    It 'is stood in for by a mock that gives <Count> windows as one list, as the real function does' -ForEach @(
        @{ Count = 0 }, @{ Count = 1 }, @{ Count = 2 }
    ) {
        $script:Handles = @($script:First, $script:Second | Select-Object -First $Count)
        Mock Get-E2eMacropadWindows { , @($script:Handles) }
        $list = Get-E2eMacropadWindows
        ($list -is [array]) | Should -BeTrue -Because 'an empty list is still a list, not nothing'
        $list.Count | Should -Be $Count
        @(Get-E2eMacropadWindows).Count | Should -Be 1 -Because 'the list is one object, so a wrap in @(...) holds the list and not its windows'
    }

    It 'gives an empty list, and not nothing, while no macropad runs' {
        $script:E2eRun.Macropad = $null
        $list = Get-E2eMacropadWindows
        ($list -is [array]) | Should -BeTrue
        $list.Count | Should -Be 0
    }

    Context 'Get-E2eOverlayPoint' {
        It 'says the overlay must show as one window when <Count> windows show, and names them' -ForEach @(@{ Count = 0; Names = 'none' }, @{ Count = 2; Names = "*$(0x0BAD0001) ''*; $(0x0BAD0002) ''*" }) {
            $script:Handles = @($script:First, $script:Second | Select-Object -First $Count)
            Mock Get-E2eMacropadWindows { , @($script:Handles) }
            { Get-E2eOverlayPoint 1 Label } | Should -Throw -ExpectedMessage "The overlay must show as one window to point at it; the macropad's visible windows: $Names."
        }

        It 'goes on past the one-window check, to the overlay''s controls, when one window shows' {
            $script:Handles = @($script:First)
            Mock Get-E2eMacropadWindows { , @($script:Handles) }
            # The handle is no window, so it has no controls: the step after the one-window check says so
            # (a handle taken for a list throws a conversion error before it).
            { Get-E2eOverlayPoint 1 Label } | Should -Throw -ExpectedMessage "The overlay's 0 controls reach 0 x 0 px from its client origin (0, 0), which is not the layout's 256 x 330 px at one scale*"
        }
    }

    Context 'Get-E2eMacropadWindowsText' {
        It 'says none when no window shows' {
            $script:Handles = @()
            Mock Get-E2eMacropadWindows { , @($script:Handles) }
            Get-E2eMacropadWindowsText | Should -BeExactly 'none'
        }

        It 'names a window with its handle, title, class and place' {
            $script:Handles = @($script:First)
            Mock Get-E2eMacropadWindows { , @($script:Handles) }
            Get-E2eMacropadWindowsText | Should -BeLike "$(0x0BAD0001) ''*at 0, 0 size 0 x 0"
        }

        It 'names two windows, one after the other' {
            $script:Handles = @($script:First, $script:Second)
            Mock Get-E2eMacropadWindows { , @($script:Handles) }
            Get-E2eMacropadWindowsText | Should -BeLike "$(0x0BAD0001) ''*at 0, 0 size 0 x 0; $(0x0BAD0002) ''*at 0, 0 size 0 x 0"
        }
    }

    # What a wait looks at: nothing while the window is not there yet (the wait goes on), the window's
    # handle once it is. Wait-E2eCondition takes an empty list for a look that was met.
    Context 'the looks of the waits' {
        It 'looks at no tooltip and gets nothing when none is up' {
            $script:Handles = @()
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Tooltips }
            $look = Get-E2eTooltip
            ($null -eq $look) | Should -BeTrue
        }

        It 'looks at the first tooltip''s handle when <Count> are up' -ForEach @(@{ Count = 1 }, @{ Count = 2 }) {
            $script:Handles = @($script:First, $script:Second | Select-Object -First $Count)
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Tooltips }
            $look = Get-E2eTooltip
            $look | Should -BeOfType ([IntPtr])
            $look | Should -Be $script:First
        }

        It 'looks at no overlay and gets nothing when <Count> windows show, so that the wait goes on' -ForEach @(@{ Count = 0 }, @{ Count = 2 }) {
            $script:Handles = @($script:First, $script:Second | Select-Object -First $Count)
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Overlay }
            $look = Get-E2eSoleOverlay
            ($null -eq $look) | Should -BeTrue
        }

        It 'looks at the overlay''s handle when one window shows' {
            $script:Handles = @($script:First)
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Overlay }
            $look = Get-E2eSoleOverlay
            $look | Should -BeOfType ([IntPtr])
            $look | Should -Be $script:First
        }

        It 'says whether a tooltip is up when the macropad has <Count> of them' -ForEach @(@{ Count = 0; Want = $false }, @{ Count = 1; Want = $true }, @{ Count = 2; Want = $true }) {
            $script:Handles = @($script:First, $script:Second | Select-Object -First $Count)
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Tooltips }
            Test-E2eTooltipUp | Should -Be $Want
        }
    }

    Context 'Get-E2eMacropadDialogText' {
        It 'says none when the macropad shows no window with a title' {
            $script:Handles = @()
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Others }
            Get-E2eMacropadDialogText | Should -BeExactly 'none'
        }

        It 'names each window with what it says, one after the other' {
            $script:Handles = @($script:First, $script:Second)
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Others }
            Get-E2eMacropadDialogText | Should -BeExactly "'' says: ; '' says: " -Because 'a handle that is no window has no title and no controls'
        }

        It 'says that the windows could not be read, and throws nothing, when reading them fails' {
            Mock Get-E2eMacropadWindows { throw 'no list' } -ParameterFilter { $Others }
            Get-E2eMacropadDialogText | Should -BeExactly 'they could not be read (no list)'
        }
    }

    # What a form says is one function of the harness, which the cases and the dialog text of a start
    # that failed both call.
    Context 'Get-E2eFormText' {
        It 'is defined once, in the harness file, and not again in the cases' {
            (Get-Command Get-E2eFormText).ScriptBlock.File | Should -Be (Join-Path $PSScriptRoot 'helpers\EndToEnd.ps1')
            (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'helpers\EndToEnd.ps1') -Raw) | Should -Match '(?m)^function Get-E2eFormText '
            (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'helpers\EndToEndCases.ps1') -Raw) | Should -Not -Match '(?m)^function Get-E2eFormText ' -Because 'a second definition would be a second copy of the expression'
        }

        It 'says nothing for a handle that is no window' {
            Get-E2eFormText $script:First | Should -BeExactly ''
        }

        It 'is what the dialog text of the macropad''s windows says of each window, as its other user, the cases, say it of a form' {
            $script:Handles = @($script:First, $script:Second)
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Others }
            Mock Get-E2eFormText { "controls of $([int]$Form)" }
            Get-E2eMacropadDialogText | Should -BeExactly "'' says: controls of $([int]$script:First); '' says: controls of $([int]$script:Second)"
            (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'helpers\EndToEndCases.ps1') -Raw) | Should -Match 'Get-E2eFormText \$ctx\.Form' -Because 'the cases call it as before'
        }
    }

    # A macropad that answers its keys has loaded its layout, except that the PowerShell one can fail
    # after it registered the macro keys (Register-LayoutHotkeys, in main.ps1) and show its message box
    # 'failed to start', whose message loop still takes the hotkeys: the start must say so.
    Context 'Start-E2eMacropad, once the macropad answers its keys' {
        BeforeEach {
            $script:E2eRun = [pscustomobject]@{ Dir = $TestDrive; Macropad = $null; Standins = @{ B = [pscustomobject]@{ Hwnd = [IntPtr]0x0BAD0003 } } }
            Mock Get-E2eMacropadEnvironment { @{} }
            Mock Start-E2eProcess { [pscustomobject]@{ Id = 4242; HasExited = $false } }
            Mock Get-E2eCommandMark { 0 }
            Mock Set-E2eActive { $true }
            Mock Wait-E2eCondition { $true }  # the macropad answers
        }

        It 'throws, naming what its <Count> window(s) say, when a window with a title shows' -ForEach @(@{ Count = 1 }, @{ Count = 2 }) {
            $script:Handles = @($script:First, $script:Second | Select-Object -First $Count)
            Mock Get-E2eMacropadWindows { , @($script:Handles) } -ParameterFilter { $Others }
            Mock Get-E2eMacropadDialogText { "'Layered Macropad failed to start' says: boom" }
            { Start-E2eMacropad ps 1 } | Should -Throw -ExpectedMessage "The ps macropad answered its keys, but it shows a window of its own, which one that loaded its layout does not*: 'Layered Macropad failed to start' says: boom."
        }

        It 'gives the macropad when no window with a title shows' {
            Mock Get-E2eMacropadWindows { , @() } -ParameterFilter { $Others }
            Mock Get-E2eMacropadDialogText { throw 'no window to name' }
            $m = Start-E2eMacropad ps 1
            $m.Lang | Should -Be 'ps'
            $m.Chunk | Should -Be 1
            Should -Invoke Get-E2eMacropadWindows -Times 1 -Exactly -ParameterFilter { $Others }
        }

        It 'does not look for the window while the macropad has not answered, where the failure names them itself' {
            Mock Wait-E2eCondition { $null }
            Mock Get-E2eMacropadWindows { throw 'not asked' }
            Mock Get-E2eCommandLines { @() }
            Mock Get-E2eMacropadDialogText { 'the windows' }
            { Start-E2eMacropad ps 1 } | Should -Throw -ExpectedMessage '*did not answer its keys within 30 s*The macropad''s windows: the windows.'
        }
    }

    # The calls a desktop is needed for (the waits inside a case) cannot be run here: the text of the
    # harness and of the cases is read instead. A call of Get-E2eMacropadWindows gives its list as one
    # object (return , @(...)), so the list must be taken as it comes, in a variable or by .Count. Which
    # forms hand that one object on as it is, checked in a PowerShell with a stub that returns , @(1, 2):
    #   Get-W | ForEach-Object { $_ }     $_ is the whole list (Object[]): wrong
    #   @(Get-W)                          a list of one element, the real list: wrong
    #   (Get-W) | ForEach-Object { $_ }   $_ is each item (Int32, Int32): right
    #   $(Get-W) | ForEach-Object { $_ }  $_ is each item (Int32, Int32): right
    # A group in brackets or a subexpression lists the array as an expression's value, item by item; a
    # command piped directly, and @(...), do not. So the test refuses a wrap and a direct pipe only. The
    # same pattern reads a sample text and the files, so the samples show what the files are held to.
    Context 'a call of Get-E2eMacropadWindows that takes the list as it comes' {
        BeforeAll {
            function Find-E2eWindowListMisuse {
                param([string]$Text)
                $pattern = '@\(\s*Get-E2eMacropadWindows|Get-E2eMacropadWindows[^|;)\r\n]*\s*\|'
                foreach ($m in [regex]::Matches($Text, $pattern)) {
                    $line = ($Text.Substring(0, $m.Index) -split "`n").Count
                    "$line`: $($m.Value.Trim())"
                }
            }
        }

        It 'finds a call <Why>' -ForEach @(
            @{ Why = 'wrapped in @(...)'; Text = '$n = @(Get-E2eMacropadWindows -Others).Count' }
            @{ Why = 'wrapped with a space after the bracket'; Text = '$n = @( Get-E2eMacropadWindows).Count' }
            @{ Why = 'wrapped across two lines'; Text = "`$n = @(`r`n    Get-E2eMacropadWindows -Others`r`n).Count" }
            @{ Why = 'piped'; Text = 'Get-E2eMacropadWindows -Others | ForEach-Object { $_ }' }
            @{ Why = 'piped, with the arguments before the pipe'; Text = '$t = Get-E2eMacropadWindows -Tooltips -Overlay | Select-Object -First 1' }
            @{ Why = 'piped to a pipe at the start of the next line'; Text = "Get-E2eMacropadWindows -Others`r`n    | ForEach-Object { `$_ }" }
        ) {
            @(Find-E2eWindowListMisuse $Text).Count | Should -Be 1
        }

        It 'finds nothing in a call that takes the list as it comes: <Why>' -ForEach @(
            @{ Why = 'a variable'; Text = '$left = Get-E2eMacropadWindows -Others  # already a list' }
            @{ Why = 'a count of the list'; Text = 'if (-not (Wait-E2eCondition { (Get-E2eMacropadWindows -Tooltips).Count -eq 0 } -TimeoutMs 6000)) { throw "no" }' }
            @{ Why = 'a count piped on'; Text = '(Get-E2eMacropadWindows -Overlay).Count | Should -Be 0' }
            @{ Why = 'a call, then a pipe in another statement'; Text = '$w = Get-E2eMacropadWindows; $w | ForEach-Object { $_ }' }
            @{ Why = 'a group in brackets, piped: the group lists the array item by item'; Text = '(Get-E2eMacropadWindows -Others) | Where-Object { $_ }' }
            @{ Why = 'a subexpression, piped: the same'; Text = '$(Get-E2eMacropadWindows -Others) | Where-Object { $_ }' }
            @{ Why = 'a variable that holds the list, piped'; Text = "`$left = Get-E2eMacropadWindows -Others`r`n`$left | ForEach-Object { `$_ }" }
        ) {
            @(Find-E2eWindowListMisuse $Text).Count | Should -Be 0
        }

        It 'is never wrapped in @(...) or piped, in the harness or in a case' {
            $found = @(foreach ($f in 'EndToEnd.ps1', 'EndToEndCases.ps1') {
                    Find-E2eWindowListMisuse (Get-Content -LiteralPath (Join-Path $PSScriptRoot "helpers\$f") -Raw) | ForEach-Object { "$f`:$_" }
                })
            $found -join "`n" | Should -BeNullOrEmpty
        }
    }
}

# The cases with Hooks, which press the layout file's hotkeys and type its hotstrings: where the slot plan
# puts them (a layout of their own, after every other), what their layout file says and what the
# PowerShell macropad's loader reads from it, what the test's command E2eHotkey writes, which keys the
# test types a hotstring with, and the text a stand-in holds after the key events it received
# (ConvertTo-E2eTypedText), which tells a hotstring's replacement from what was typed.
Describe 'End-to-end hotkeys and hotstrings: a layout of their own, and the text a stand-in holds' {
    BeforeAll {
        foreach ($f in 'Assets', 'Model', 'ConfigJson', 'Hotkeys') { . "$root\powershell\lib\$f.ps1" }
        . "$PSScriptRoot\helpers\EndToEndCases.ps1"
        $script:DirBefore = $env:OMB_E2E_DIR
    }
    BeforeEach {
        $env:OMB_E2E_DIR = $TestDrive
        $script:E2eRun = [pscustomobject]@{ Dir = $TestDrive; Chunks = 0; Deadline = [DateTime]::MaxValue; LimitMinutes = 20; Case = ''; SlowWaits = [System.Collections.Generic.List[string]]::new() }
    }
    AfterEach { $script:E2eRun = $null }
    AfterAll { $env:OMB_E2E_DIR = $script:DirBefore }

    Context 'ConvertTo-E2eTypedText' {
        It 'folds what a stand-in received into the text a text box would hold' {
            ConvertTo-E2eTypedText @(
                'down vk=45 sc=012 repeat=0 mods=-', 'up vk=45 sc=012 repeat=0 mods=-',   # e
                'down vk=32 sc=003 repeat=0 mods=-',                                       # 2
                'down vk=08 sc=00E repeat=0 mods=-',                                       # Backspace
                'char 0062', 'down vk=20 sc=039 repeat=0 mods=-',                          # b, Space
                'down vk=41 sc=01E repeat=0 mods=S', 'down vk=41 sc=01E repeat=0 mods=C'   # A, then Ctrl+A (no text)
            ) | Should -BeExactly 'eb A'
        }

        It 'folds <Why>' -ForEach @(
            @{ Why = 'a letter with Shift held into a capital'; Lines = @('down vk=42 sc=030 repeat=0 mods=S'); Want = 'B' }
            @{ Why = 'a letter alone into a small one'; Lines = @('down vk=5A sc=02C repeat=0 mods=-'); Want = 'z' }
            @{ Why = 'a key of the digit row into its digit'; Lines = @('down vk=30 sc=00B repeat=0 mods=-', 'down vk=39 sc=00A repeat=0 mods=-'); Want = '09' }
            @{ Why = 'a key of the digit row with Shift into nothing: it is not mapped'; Lines = @('down vk=31 sc=002 repeat=0 mods=S'); Want = '' }
            @{ Why = 'Space with Shift held into a space'; Lines = @('down vk=20 sc=039 repeat=0 mods=S'); Want = ' ' }
            @{ Why = 'Backspace on empty text into nothing taken away'; Lines = @('down vk=08 sc=00E repeat=0 mods=-', 'char 0061'); Want = 'a' }
            @{ Why = 'Backspace after typed characters into one taken away'; Lines = @('char 0061', 'char 0062', 'down vk=08 sc=00E repeat=0 mods=-'); Want = 'a' }
            @{ Why = 'typed characters into themselves, a space among them'; Lines = @('char 0062', 'char 0020', 'char 0079'); Want = 'b y' }
            @{ Why = 'a key held down into a character for its press and one for each repeat'; Lines = @('down vk=45 sc=012 repeat=0 mods=-', 'down vk=45 sc=012 repeat=1 mods=-', 'down vk=45 sc=012 repeat=1 mods=-', 'up vk=45 sc=012 repeat=0 mods=-'); Want = 'eee' }
            @{ Why = 'keys with Ctrl, Alt or Win held into nothing'; Lines = @('down vk=41 sc=01E repeat=0 mods=C', 'down vk=46 sc=021 repeat=0 mods=A', 'down vk=79 sc=044 repeat=0 mods=CA', 'down vk=44 sc=020 repeat=0 mods=W', 'down vk=54 sc=014 repeat=0 mods=CS', 'down vk=20 sc=039 repeat=0 mods=C'); Want = '' }
            @{ Why = 'key ups, keys it does not map and lines that are no keys into nothing'; Lines = @('up vk=41 sc=01E repeat=0 mods=-', 'down vk=70 sc=03B repeat=0 mods=-', 'down vk=0D sc=01C repeat=0 mods=-', 'down vk=E8 sc=000 repeat=0 mods=-', 'down vk=7E sc=066 repeat=0 mods=-', 'down vk=10 sc=02A repeat=0 mods=S', 'click left 3 4', 'command 35024', 'close', 'start B pid=1 hwnd=2', 'char 000D'); Want = '' }
            @{ Why = 'no lines into no text'; Lines = @(); Want = '' }
        ) {
            ConvertTo-E2eTypedText $Lines | Should -BeExactly $Want
        }

        It 'reads the text a stand-in holds from the lines of its log after a mark' {
            $standin = [pscustomobject]@{ Name = 'B'; Log = (Join-Path $TestDrive 'standin-B.log') }
            [System.IO.File]::WriteAllText($standin.Log, "start B pid=1 hwnd=2`nchar 0078`ndown vk=45 sc=012 repeat=0 mods=-`nchar 0062`n")
            Get-E2eStandinText $standin 2 | Should -BeExactly 'eb' -Because 'the x before the mark is not counted'
            Get-E2eStandinText $standin | Should -BeExactly 'xeb'
        }
    }

    Context 'typing' {
        It 'types a text a key at a time, into the window it names, each character its own key with no modifier' {
            $script:Taps = [System.Collections.Generic.List[string]]::new()
            Mock Assert-E2eFront { }
            Mock Send-E2eTap { $script:Taps.Add('{0:X2}' -f $Vk) }
            Mock Send-E2eKey { throw 'no key goes down but through Send-E2eTap' }
            Mock Wait-Pump { }
            Send-E2eText ([IntPtr]0x0BAD0001) 'e2ebtw '
            $script:Taps -join ' ' | Should -BeExactly '45 32 45 42 54 57 20'
            Should -Invoke Assert-E2eFront -Times 7 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]0x0BAD0001 } -Because 'each key is pressed only while the window is in front'
        }
    }

    Context 'hotkeys.log' {
        It 'gets from E2eHotkey the name of its macro, which is the hotkey or the hotstring as the layout writes it' {
            Get-E2eHotkeyMark | Should -Be 0
            @(Get-E2eHotkeyLines 0).Count | Should -Be 0
            E2eHotkey (Macro 'E2eHotkey' '^!F9')
            $mark = Get-E2eHotkeyMark
            E2eHotkey (Macro 'E2eHotkey' ':X:e2erun')
            $mark | Should -Be 1
            @(Get-E2eHotkeyLines 0) -join ' / ' | Should -BeExactly '^!F9 / :X:e2erun'
            @(Get-E2eHotkeyLines $mark) -join ' / ' | Should -BeExactly ':X:e2erun'
            Get-E2eHotkeyLogPath | Should -Be (Join-Path $TestDrive 'hotkeys.log') -Because 'it is in the run''s folder, which the clean-up removes'
        }
    }

    # What a failed case says it saw (Get-E2eHookSeen) names the macropad's windows: a message box 'failed to
    # start' of the PowerShell macropad is not in any log, and is closed by the clean-up after the case.
    Context 'Get-E2eHookSeen' {
        BeforeEach {
            $script:Standin = [pscustomobject]@{ Name = 'B'; Log = (Join-Path $TestDrive 'standin-B.log') }
            Mock Get-E2eErrorLines { @() }
            Mock Get-E2eCommandLines { @() }
            Mock Get-E2eForegroundText { "'B' (e2eapp.exe, class AutoHotkeyGUI)" }
        }

        It 'names the macropad''s windows and what they say' {
            Mock Get-E2eMacropadDialogText { "'Layered Macropad failed to start' says: boom | OK" }
            Get-E2eHookSeen $script:Standin 0 0 0 | Should -BeExactly "hotkeys.log since: nothing; B's lines since: nothing; the macropad's error log: nothing; its command log since: nothing; in front: 'B' (e2eapp.exe, class AutoHotkeyGUI); the macropad's windows: 'Layered Macropad failed to start' says: boom | OK"
        }

        It 'says none when the macropad shows no window with a title, from the list as Get-E2eMacropadWindows gives it' {
            Mock Get-E2eMacropadWindows { , @() } -ParameterFilter { $Others }
            Get-E2eHookSeen $script:Standin 0 0 0 | Should -BeLike "*; in front: *; the macropad's windows: none"
        }

        It 'names a window of the macropad''s that the real list holds' {
            Mock Get-E2eMacropadWindows { , @([IntPtr]0x0BAD0001) } -ParameterFilter { $Others }
            Get-E2eHookSeen $script:Standin 0 0 0 | Should -BeLike "*; the macropad's windows: '' says: "
        }
    }

    # E2eHotstringAction holds the window to what a hotstring with an action leaves of the abbreviation: nothing,
    # or the Space it was ended with (AutoHotkey may type the ending character again, and the PowerShell
    # macropad does), and no part of the abbreviation. What each version's log folds to for each outcome
    # (the keys down are e 2 e r u n, then Backspaces, then the Space as the version types it; the key ups,
    # which add nothing, are left out):
    Context 'Assert-E2eAbbreviationErased' {
        BeforeAll {
            $script:Down = { param($vk) "down vk=$vk sc=000 repeat=0 mods=-" }
            $script:Typed = @('45', '32', '45', '52', '55', '4E') | ForEach-Object { & $script:Down $_ }
        }

        It '<Version>, <What>: the text folds to "<Fold>", and the check passes: <Passes>' -ForEach @(
            @{ Version = 'ahk'; What = 'all 6 erased, the ending Space not typed again'; Backspaces = 6; Ending = @(); Fold = ''; Passes = $true }
            @{ Version = 'ahk'; What = 'all 6 erased, the ending Space typed again'; Backspaces = 6; Ending = @('20'); Fold = ' '; Passes = $true }
            @{ Version = 'ps'; What = 'all 6 erased, the Space typed after them'; Backspaces = 6; Ending = @('char'); Fold = ' '; Passes = $true }
            @{ Version = 'ahk'; What = '1 of 6 erased'; Backspaces = 1; Ending = @(); Fold = 'e2eru'; Passes = $false }
            @{ Version = 'ahk'; What = '5 of 6 erased'; Backspaces = 5; Ending = @(); Fold = 'e'; Passes = $false }
            @{ Version = 'ps'; What = '1 of 6 erased'; Backspaces = 1; Ending = @('char'); Fold = 'e2eru '; Passes = $false }
            @{ Version = 'ps'; What = '5 of 6 erased'; Backspaces = 5; Ending = @('char'); Fold = 'e '; Passes = $false }
            @{ Version = 'ahk'; What = 'none erased (the action ran, the keys stayed)'; Backspaces = 0; Ending = @(); Fold = 'e2erun'; Passes = $false }
            @{ Version = 'ps'; What = 'none erased, the Space typed'; Backspaces = 0; Ending = @('char'); Fold = 'e2erun '; Passes = $false }
            @{ Version = 'ps'; What = 'none erased, the Space let through (the hotstring did not fire)'; Backspaces = 0; Ending = @('20'); Fold = 'e2erun '; Passes = $false }
        ) {
            $lines = @($script:Typed) + (@(& $script:Down '08') * $Backspaces) + @($Ending | ForEach-Object { if ($_ -eq 'char') { 'char 0020' } else { & $script:Down $_ } })
            $text = ConvertTo-E2eTypedText $lines
            $text | Should -BeExactly $Fold
            $outcome = { Assert-E2eAbbreviationErased $text 'seen' }
            if ($Passes) { $outcome | Should -Not -Throw } else { $outcome | Should -Throw -ExpectedMessage '*the hotstring erases the abbreviation it was typed with*' }
        }
    }

    Context 'the layouts' {
        It 'leaves every case without Hooks on its key, and puts the cases with Hooks in a layout of their own after them' {
            $before = Get-E2eSlotPlan 118 -KeyCount 11
            $plan = Get-E2eSlotPlan 118 -KeyCount 11 -Hooks 6
            $plan.Count | Should -Be 124
            $row = { param($p) "$($p.Chunk) $($p.Layer) $($p.Slot) $($p.Hooks)" }
            (@(0..117 | ForEach-Object { & $row $plan[$_] }) -join ', ') | Should -BeExactly (@(0..117 | ForEach-Object { "$($before[$_].Chunk) $($before[$_].Layer) $($before[$_].Slot) False" }) -join ', ')
            (@(118..123 | ForEach-Object { & $row $plan[$_] }) -join ', ') | Should -BeExactly '2 1 3 True, 2 1 4 True, 2 1 5 True, 2 1 6 True, 2 1 7 True, 2 1 8 True'
        }

        It 'starts the layout of the cases with Hooks after the last layout of the others' {
            $plan = Get-E2eSlotPlan 250 -KeyCount 11 -Hooks 2
            (@($plan | Select-Object -Skip 250 | ForEach-Object { "$($_.Chunk) $($_.Layer) $($_.Slot)" }) -join ', ') | Should -BeExactly '4 1 3, 4 1 4' -Because '250 cases fill three layouts of 119'
        }

        It 'puts the cases with Hooks in the first layout when they are the only ones (run.ps1 -Case)' {
            $plan = Get-E2eSlotPlan 0 -KeyCount 11 -Hooks 2
            (@($plan | ForEach-Object { "$($_.Chunk) $($_.Layer) $($_.Slot) $($_.Hooks)" }) -join ', ') | Should -BeExactly '1 1 3 True, 1 1 4 True'
        }

        It 'writes the hotkeys and hotstrings into the layout of the cases with Hooks only, wherever those stand in the list' {
            $cases = @(@{ Command = 'E2ePlainOne' }, @{ Command = 'E2eNothing'; Hooks = $true }, @{ Command = 'E2ePlainTwo' })
            Write-E2eLayout $cases
            "$($cases[0].Chunk) $($cases[0].Slot), $($cases[2].Chunk) $($cases[2].Slot), $($cases[1].Chunk) $($cases[1].Slot)" | Should -BeExactly '1 3, 1 4, 2 3'
            $script:E2eRun.Chunks | Should -Be 2
            $entries = { param($list) @($list | ForEach-Object { @($_.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ';' }) -join ' / ' }
            foreach ($lang in 'ahk', 'ps') {
                $plain = [System.IO.File]::ReadAllText((Join-Path $TestDrive "layout-$lang-1.json")) | ConvertFrom-Json
                @($plain.PSObject.Properties.Name) | Should -Not -Contain 'hotkeys' -Because "the $lang layout of the other cases has no hotkeys"
                @($plain.PSObject.Properties.Name) | Should -Not -Contain 'hotstrings'
                $hooks = [System.IO.File]::ReadAllText((Join-Path $TestDrive "layout-$lang-2.json")) | ConvertFrom-Json
                & $entries $hooks.hotkeys | Should -BeExactly 'hotkey=^!F9;action=E2eHotkey / hotkey=^!F10;action=E2eHotkey;ifWinActive=ahk_exe e2eapp.exe / hotkey=^!F11;action=E2eHotkey;ifWinNotActive=ahk_exe e2eapp.exe'
                & $entries $hooks.hotstrings | Should -BeExactly 'hotstring=::e2ebtw;replacement=by the way / hotstring=:X:e2erun;action=E2eHotkey'
                @(@($hooks.layers)[0].macros | ForEach-Object { $_.action }) -join ',' | Should -BeExactly 'E2eMark,E2eExit,E2eNothing'
            }
        }

        It 'writes hotkeys and hotstrings that the PowerShell macropad loads, with actions it has' {
            Write-E2eLayout @(@{ Command = 'E2eNothing'; Hooks = $true })
            $defs = @(Import-MacropadHotkeys (Join-Path $TestDrive 'layout-ps-1.json'))
            (@($defs | ForEach-Object { "$($_.Kind)|$($_.Spec)|$($_.Macro.Name)|$($_.Replacement)|$($_.IfWinActive)|$($_.IfWinNotActive)" }) -join ' / ') |
                Should -BeExactly 'Hotkey|^!F9|^!F9||| / Hotkey|^!F10|^!F10||ahk_exe e2eapp.exe| / Hotkey|^!F11|^!F11|||ahk_exe e2eapp.exe / Hotstring|::e2ebtw||by the way|| / Hotstring|:X:e2erun|:X:e2erun|||'
            { Test-HotkeyActions $defs } | Should -Not -Throw -Because 'E2eHotkey is one of the test''s own commands (ahk\tests\e2e\commands.ps1)'
        }

        It 'runs the cases with Hooks after every other case of the table, and they are the six that press hotkeys and type hotstrings' {
            $all = @(Get-E2eCases -All)
            $flags = @($all | ForEach-Object { [bool]$_.Hooks })
            $first = [array]::IndexOf($flags, $true)
            $first | Should -BeGreaterThan 0
            @($flags | Select-Object -Skip $first) | Should -Not -Contain $false -Because 'a case without Hooks after them would start the macropad again with the other layout'
            (@($all | Where-Object { $_.Hooks } | ForEach-Object { if ($_.Name) { $_.Name } else { $_.Command } }) -join ', ') |
                Should -BeExactly 'E2eHotkey, E2eHotkeyIfWinActive, E2eHotkeyIfWinNotActive, E2eHotstringText, E2eHotstringAction, E2eChordWithHooks'
        }
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

# What a failed case says of the keyboard (Get-E2eFailureState): the key watch's record as one line, and
# how a NextWindow press's Alt+Tab went out. The record here is made up, in the key watch's own form
# (KeyWatch.Timed): a PowerShell NextWindow press at 2000.0 ms that left the task switcher in front, after
# the arrange made B and then A active (the activation tapped Alt, tagged MPAD, before the press).
Describe 'End-to-end account of a failed case: the key watch''s record and the timing of Alt+Tab' {
    BeforeAll {
        $T = "`t"
        $script:Record = @(
            "front${T}1000.0${T}11${T}AutoHotkeyGUI${T}OMB e2e stand-in: A"
            "key${T}1500.2${T}down${T}A4${T}4D504144"
            "key${T}1500.9${T}up${T}A4${T}4D504144"
            "front${T}1600.0${T}22${T}AutoHotkeyGUI${T}OMB e2e stand-in: B"
            "front${T}1990.0${T}11${T}AutoHotkeyGUI${T}OMB e2e stand-in: A"
            "key${T}2000.4${T}down${T}84${T}0"
            "key${T}2041.0${T}up${T}84${T}0"
            "key${T}2212.4${T}down${T}A4${T}4D504144"
            "key${T}2219.8${T}down${T}09${T}4D504144"
            "key${T}2224.0${T}up${T}09${T}4D504144"
            "key${T}2228.3${T}up${T}A4${T}4D504144"
            "front${T}2231.0${T}33${T}XamlExplorerHostIslandWindow${T}Task Switching"
        )
        $script:Exes = @{ 11 = 'chrome.exe'; 22 = 'e2eapp.exe' }
        $script:SincePress = "+0.4 down F21 untagged, +41.0 up F21 untagged, +212.4 down LAlt MPAD, +219.8 down Tab MPAD, +224.0 up Tab MPAD, +228.3 up LAlt MPAD, +231.0 front 'Task Switching' (pid 33, XamlExplorerHostIslandWindow)"
    }

    It 'gives the keys and the windows that came in front in one line, in the record''s order, in ms from the press' {
        Format-E2eRecord $script:Record 2000.0 $script:Exes | Should -BeExactly (
            "-1000.0 front 'OMB e2e stand-in: A' (chrome.exe, AutoHotkeyGUI), -499.8 down LAlt MPAD, -499.1 up LAlt MPAD, " +
            "-400.0 front 'OMB e2e stand-in: B' (e2eapp.exe, AutoHotkeyGUI), -10.0 front 'OMB e2e stand-in: A' (chrome.exe, AutoHotkeyGUI), $script:SincePress")
    }

    It 'says what a time means, and counts from the press' {
        $line = Format-E2eAccountRecord $script:Record 2000.0 $true $true $script:Exes
        $line | Should -BeLike "  the key watch's record, in the order it got them (ms after the key went down; a key: when the key watch saw it; a window that came in front: when the key watch was told of it, an upper bound): -1000.0 front *"
        $line | Should -BeLike "*, $script:SincePress"
    }

    It 'counts from the record''s first line when no key went down (a press time of $null)' {
        Format-E2eAccountRecord $script:Record $null $true $true $script:Exes |
            Should -BeLike "  the key watch's record, in the order it got them (ms after the record began, as no key went down; *): +0.0 front 'OMB e2e stand-in: A' (chrome.exe, AutoHotkeyGUI), +500.2 down LAlt MPAD, *, +1231.0 front 'Task Switching' (pid 33, XamlExplorerHostIslandWindow)"
    }

    It 'says nothing was recorded, with <What>' -ForEach @(
        @{ What = 'an empty record'; Lines = @(); Press = 2000.0 }
        @{ What = 'no record at all'; Lines = $null; Press = 2000.0 }
        @{ What = 'an empty record and no press'; Lines = @(); Press = $null }
    ) {
        Format-E2eAccountRecord $Lines $Press $true $false | Should -BeLike "  the key watch's record, in the order it got them (*): nothing"
    }

    It 'says why no window that came in front is recorded: <Why>' -ForEach @(
        @{ Why = 'the case does not turn the hook on'; Timed = $false; Says = "*; a key: when the key watch saw it; the only window is the one in front when the record began, as the foreground hook runs only during the cases of NextWindow): -1000.0 front *" }
        @{ Why = 'the case turns it on and that failed'; Timed = $true; Says = "*; a key: when the key watch saw it; the only window is the one in front when the record began, as the foreground hook, which this case turns on, could not be turned on (said before the case's lines)): -1000.0 front *" }
    ) {
        Format-E2eAccountRecord $script:Record 2000.0 $false $Timed $script:Exes | Should -BeLike $Says
    }

    It 'cuts a long record in the middle, keeping its first ten and its last thirty entries' {
        $T = "`t"
        $long = @(foreach ($n in 1..50) { "key${T}$n.0${T}down${T}41${T}0" })
        $items = @((Format-E2eRecord $long 0.0 -Max 40) -split ', ')
        $items.Count | Should -Be 41
        $items[9] | Should -BeExactly '+10.0 down vk41 untagged'
        $items[10] | Should -BeExactly '... 10 more ...'
        $items[11] | Should -BeExactly '+21.0 down vk41 untagged'
        $items[40] | Should -BeExactly '+50.0 down vk41 untagged'
    }

    It 'names a key with AutoHotkey''s tag by that tag' {
        ConvertTo-E2eRecordKeyText @('key', '1.0', 'down', '12', 'FFFFFFFFFFFFFFF0') | Should -BeExactly 'down Alt tag FFFFFFFFFFFFFFF0'
    }

    It 'reads the line the key watch itself writes' {
        # KeyWatch.Clear writes the window in front as the record's first line; nothing is hooked for it.
        [OmbE2e.KeyWatch]::Clear()
        $lines = @([OmbE2e.KeyWatch]::Timed())
        $lines.Count | Should -Be 1
        ($lines[0] -split "`t").Count | Should -Be 5
        Format-E2eRecord $lines ([OmbE2e.KeyWatch]::Now()) | Should -Match "^[+-]\d+\.\d front '.*' \(pid \d+, .*\)$"
        [OmbE2e.KeyWatch]::WatchFront($true) | Should -BeFalse -Because 'the hook can be turned on only on a key watch that runs'
    }

    It 'times the command''s Alt+Tab after the press, leaving out the activation''s Alt tap before it' {
        $times = Get-E2eChordTimes $script:Record 2000.0
        "$($times.AltDown) $($times.TabDown) $($times.TabUp) $($times.AltUp) $($times.KeyUp)" | Should -BeExactly '212.4 219.8 224 228.3 41'
        Format-E2eChordTimes $times | Should -BeExactly 'Alt down +212.4, Tab down +219.8, Tab up +224, Alt up +228.3 ms after the key went down (the key went up +41); Alt down to Tab down 7.4, Tab held 4.2, Tab up to Alt up 4.3, Alt held 15.9 ms'
    }

    It 'says what of the Alt+Tab it did not see' {
        Format-E2eChordTimes (Get-E2eChordTimes @($script:Record | Select-Object -First 10) 2000.0) |
            Should -BeExactly 'Alt down +212.4, Tab down +219.8, Tab up +224, Alt up not seen ms after the key went down (the key went up +41); Alt down to Tab down 7.4, Tab held 4.2, Tab up to Alt up -, Alt held - ms'
        Format-E2eChordTimes (Get-E2eChordTimes @() 2000.0) | Should -BeExactly 'the key watch saw no Alt down of the command after the key went down'
    }

    It 'reads the case''s own key and Fn with Alt, Ctrl, Shift, Win and Tab' {
        (@(Get-E2eAccountKeys 9) | ForEach-Object { $_.Name }) -join ', ' | Should -BeExactly "LAlt, RAlt, LCtrl, RCtrl, LShift, RShift, LWin, RWin, Tab, F21 (the case's key), F24 (Fn)"
        @(Get-E2eAccountKeys 9)[9].Vk | Should -Be 0x84
    }

    It 'gives the account''s lines, reading only, for a case that pressed nothing' {
        $ctx = @{ Case = @{ Command = 'E2eStep'; Slot = 3 }; Pressed = $false }
        $state = Get-E2eFailureState $ctx
        $lines = @($state -split "`n")
        $lines[0] | Should -BeExactly 'The state at the failure, read before the clean-up let go of any key:'
        $lines[1] | Should -BeLike '  keys down, as Windows has them now (GetAsyncKeyState): *'
        $lines[3] | Should -BeLike '  window in front: now * (no key went down)'
        $lines[4] | Should -BeLike "  the key watch's record, in the order it got them (ms after the record began, as no key went down; *"
        $lines[5] | Should -BeLike '  pointer: *,*, over *'
        $lines[6] | Should -BeLike '  visible windows, top first: *'
        Get-E2eFailureState $ctx -AfterCleanUp | Should -BeLike '  after the clean-up: in front *; keys down: *'
    }
}
