# The end-to-end test of the macropad, in both of its versions. It starts the real macropad on a real
# desktop with a test layout (OMB_CONFIG), presses the real macro keys with SendInput, and checks what
# really happened: a window that opened and is active, a file a script wrote, a window that moved, or
# the exact keys a stand-in window received. The last cases press the hotkeys and type the hotstrings of
# the layout file, in a layout of their own (the only one with "hotkeys" and "hotstrings"), so that
# the key hook those bring cannot touch the other cases. Every case runs twice, once against the AutoHotkey
# macropad (ahk\main.ahk) and once against the PowerShell one (powershell\main.ps1). The cases are in
# helpers\EndToEndCases.ps1, the harness in helpers\EndToEnd.ps1, the fixtures in ahk\tests\e2e.
#
# Run it with: powershell -NoProfile -File powershell\tests\run.ps1 -EndToEnd
# run.ps1 starts a process for it, and the desktop part refuses to run anywhere else. It takes the
# keyboard, the mouse and the screen for a few minutes. Photosensitivity warning: it opens, moves and
# closes windows (at most three changes a second; see Wait-ScreenChange).
#
# Why the coverage of the two languages differs where it does (the parity test below holds the rest):
# - The PowerShell version also has unit tests with mocks (Commands.Tests.ps1, Chrome.Tests.ps1,
#   Helpers.Tests.ps1 and the others), so a PowerShell command is tested twice: there, and here.
# - The AutoHotkey version has no unit tests, by the owner's decision. Its coverage is this suite and
#   the tests that read its scripts: it loads (AhkLoad.Tests.ps1), every key name exists, and both
#   languages press the same keys (KeyNames.Tests.ps1, ChordParity.Tests.ps1).

BeforeDiscovery {
    . "$PSScriptRoot\helpers\EndToEndCases.ps1"
    $Cases = @(foreach ($c in Get-E2eCases) { @{ Name = $(if ($c.Name) { $c.Name } else { $c.Command }) } })
    $Langs = @(@{ Lang = 'ahk'; Title = 'AutoHotkey macropad' }, @{ Lang = 'ps'; Title = 'PowerShell macropad' })
}

BeforeAll {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    # Assets, Model and ConfigJson: the model of a layout, from which the test finds the overlay's keys.
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'WinTitle', 'WindowOps', 'Window', 'Sound', 'Assets', 'Model', 'ConfigJson') { . "$root\powershell\lib\$f.ps1" }
    . "$PSScriptRoot\helpers\Ahk.ps1"
    . "$PSScriptRoot\helpers\CommandSource.ps1"
    . "$PSScriptRoot\helpers\EndToEnd.ps1"
    . "$PSScriptRoot\helpers\EndToEndCases.ps1"

    # The commands of the shared command files of a language: name -> file ('custom\vscode').
    function Get-E2eSharedCommand {
        param([ValidateSet('ahk', 'ps')][string]$Lang)
        $result = [ordered]@{}
        if ($Lang -eq 'ahk') { $dir = Join-Path $root 'ahk\commands'; $filter = '*.ahk' } else { $dir = Join-Path $root 'powershell\commands'; $filter = '*.ps1' }
        foreach ($file in Get-ChildItem -LiteralPath $dir -Recurse -Filter $filter | Sort-Object FullName) {
            $pair = $file.FullName.Substring($dir.Length + 1) -replace '\.(ahk|ps1)$', ''
            if ($Lang -eq 'ahk') { $functions = Get-AhkFunctionSource $file.FullName } else { $functions = Get-PsFunctionSource $file.FullName }
            foreach ($name in $functions.Keys) { if ($functions[$name].Params -eq 'Macro') { $result[$name] = $pair } }
        }
        $result
    }

    # The PowerShell twin's chords of every shared command that is only sends: name -> chords.
    function Get-E2eTwinChords {
        $result = @{}
        foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root 'powershell\commands') -Recurse -Filter *.ps1) {
            $functions = Get-PsFunctionSource $file.FullName
            foreach ($name in $functions.Keys) { if ($null -ne $functions[$name].Chord) { $result[$name] = @($functions[$name].Chord) } }
        }
        $result
    }
}

# The pacing is a rule about two numbers: how long ago the screen last changed, and the floor. These
# tests hand the rule its clock (how long ago) and look at what it asks Wait-Pump for. They do not live
# through the time and measure it: a slow machine stretches that, and a test that measures it fails
# there for no fault of the rule.
Describe 'End-to-end pacing' -Tag EndToEnd {
    BeforeEach { Mock Wait-Pump { } }
    AfterEach { $script:E2eChangeClock = $null }

    It 'waits for nothing before the first change, and counts it from then' {
        $script:E2eChangeClock = $null
        Wait-ScreenChange
        Should -Invoke Wait-Pump -Times 0 -Exactly
        $script:E2eChangeClock.IsRunning | Should -BeTrue
    }
    It 'waits for what is left of 350 ms since the last change' {
        $script:E2eChangeClock = [pscustomobject]@{ ElapsedMilliseconds = 120 }
        Wait-ScreenChange
        Should -Invoke Wait-Pump -Times 1 -Exactly -ParameterFilter { $Milliseconds -eq 230 }
        $script:E2eChangeClock.IsRunning | Should -BeTrue -Because 'the change is counted from when it is made'
    }
    It 'waits for nothing when the last change is <Ago> ms ago' -ForEach @(@{ Ago = 350 }, @{ Ago = 5000 }) {
        $script:E2eChangeClock = [pscustomobject]@{ ElapsedMilliseconds = $Ago }
        Wait-ScreenChange
        Should -Invoke Wait-Pump -Times 0 -Exactly
    }
    It 'counts a change that was seen to happen, without waiting, so the next one keeps its distance from it' {
        $script:E2eChangeClock = [pscustomobject]@{ ElapsedMilliseconds = 5000 }
        Wait-ScreenChange -Observed
        Should -Invoke Wait-Pump -Times 0 -Exactly
        $script:E2eChangeClock.IsRunning | Should -BeTrue -Because 'the change that was seen is the last one now'
    }
}

# Every command of a language's shared files is in one of three states: covered (a case runs it
# wherever the suite runs), conditional (its only cases need something a machine may lack, said on the
# row, such as a second monitor) or excluded (with the reason).
Describe 'End-to-end accounting: <Title>' -Tag EndToEnd -ForEach $Langs {
    BeforeAll {
        $shared = Get-E2eSharedCommand $Lang
        $cases = @(Get-E2eCases -All | Where-Object { $_.File -ne 'e2e' -and (-not $_.Only -or $_.Only -eq $Lang) })
        $covered = @($cases | Where-Object { -not $_.Needs } | ForEach-Object { $_.Command } | Sort-Object -Unique)
        $conditional = @($cases | Where-Object { $_.Needs -and $covered -notcontains $_.Command } | ForEach-Object { $_.Command } | Sort-Object -Unique)
        $excluded = Get-E2eExclusions
    }
    It 'covers every command of the shared command files, runs it where it can, or excludes it with a reason' {
        $bad = foreach ($name in $shared.Keys) {
            if ($covered -notcontains $name -and $conditional -notcontains $name -and -not $excluded.ContainsKey($name)) { "$name ($($shared[$name])) has no case and is not excluded" }
        }
        $bad | Should -BeNullOrEmpty
        Write-Host ("End-to-end, {0}: {1} covered, {2} conditional, {3} excluded, of {4} commands." -f $Title, $covered.Count, $conditional.Count, $excluded.Count, $shared.Count)
        # One line for every conditional command, with what it needs: this is where a reader learns
        # what the suite does not prove on their machine. From the names, not from the cases: a case is
        # a hashtable, and Sort-Object <key> -Unique does not compare hashtables by a key (it kept one).
        $lines = @(foreach ($name in $conditional) { "  conditional: ${name}: $(@($cases | Where-Object { $_.Command -eq $name } | ForEach-Object { $_.Needs.Why } | Sort-Object -Unique) -join '; ')" })
        $lines.Count | Should -Be $conditional.Count -Because 'every conditional command is printed, once, with what it needs'
        foreach ($line in $lines) { Write-Host $line }
        foreach ($name in $excluded.Keys | Sort-Object) { Write-Host "  excluded: ${name}: $($excluded[$name])" }
    }
    It 'names only commands that exist, and excludes nothing it covers' {
        $bad = @(foreach ($c in $cases) { if (-not $shared.Contains($c.Command)) { "the case $($c.Command) names no command of the $Lang files" } elseif ($shared[$c.Command] -ne $c.File) { "the case $($c.Command) says $($c.File); the command is in $($shared[$c.Command])" } }) +
        @(foreach ($name in $excluded.Keys) {
                if (-not $shared.Contains($name)) { "the exclusion $name names no command of the $Lang files" }
                if ($covered -contains $name -or $conditional -contains $name) { "$name is excluded and has a case" }
                if ([string]::IsNullOrWhiteSpace($excluded[$name])) { "$name is excluded without a reason" }
            })
        $bad | Should -BeNullOrEmpty
    }
    It 'gives every case for one language, and every conditional case, its reason' {
        @(Get-E2eCases -All | Where-Object { ($_.Only -and [string]::IsNullOrWhiteSpace($_.Why)) -or ($_.Needs -and ([string]::IsNullOrWhiteSpace($_.Needs.Why) -or $_.Needs.Met -isnot [scriptblock])) } | ForEach-Object { $_.Command }) | Should -BeNullOrEmpty
    }
}

Describe 'End-to-end layouts' -Tag EndToEnd {
    It 'puts every case on a key, and goes on in another layout when one is full' {
        $plan = Get-E2eSlotPlan 250 -KeyCount 11
        $plan.Count | Should -Be 250
        ($plan | Measure-Object Chunk -Maximum).Maximum | Should -Be 3 -Because '119 cases fit a layout of 11 layers of 11 keys beside the two harness keys'
        @($plan | Where-Object { $_.Layer -lt 1 -or $_.Layer -gt 11 -or $_.Slot -lt 1 -or $_.Slot -gt 11 }).Count | Should -Be 0
        @($plan | Where-Object { $_.Layer -eq 1 -and $_.Slot -le 2 }).Count | Should -Be 0 -Because 'the first two keys of each layout are the harness''s own'
        @($plan | Group-Object { "$($_.Chunk) $($_.Layer) $($_.Slot)" } | Where-Object Count -gt 1).Count | Should -Be 0 -Because 'no two cases share a key'
    }
    It 'draws the overlay with the display options of the example layout, labels and markers among them' {
        $options = Get-E2eLayoutOptions
        $options.showLabels | Should -BeTrue
        $options.showMacroMarkers | Should -BeTrue
        $options.showFn | Should -Not -BeNullOrEmpty
    }
}
Describe 'End-to-end parity of the two languages' -Tag EndToEnd {
    It 'covers a command in one language only where the other has none, or says why' {
        $ahk = Get-E2eSharedCommand 'ahk'
        $ps = Get-E2eSharedCommand 'ps'
        $oneLanguage = Get-E2eOneLanguageCommands
        $excluded = Get-E2eExclusions
        $all = Get-E2eCases -All | Where-Object { $_.File -ne 'e2e' }
        $coveredIn = @{
            ahk = @($all | Where-Object { -not $_.Only -or $_.Only -eq 'ahk' } | ForEach-Object { $_.Command })
            ps  = @($all | Where-Object { -not $_.Only -or $_.Only -eq 'ps' } | ForEach-Object { $_.Command })
        }
        $names = @(@($ahk.Keys) + @($ps.Keys) | Sort-Object -Unique)
        $bad = foreach ($n in $names) {
            $inAhk = $ahk.Contains($n); $inPs = $ps.Contains($n)
            if ($inAhk -ne $inPs) {
                if (-not $oneLanguage.ContainsKey($n)) { "$n is a command of the $(if ($inAhk) { 'AutoHotkey' } else { 'PowerShell' }) files only, and Get-E2eOneLanguageCommands does not say why" }
                continue
            }
            if ($excluded.ContainsKey($n)) { continue }
            $a = $coveredIn.ahk -contains $n; $p = $coveredIn.ps -contains $n
            if ($a -ne $p) {
                $only = @($all | Where-Object { $_.Command -eq $n -and $_.Only })
                if (-not ($only | Where-Object { $_.Why })) { "$n is covered for $(if ($a) { 'AutoHotkey' } else { 'PowerShell' }) only, with no reason on its case" }
            }
        }
        $bad | Should -BeNullOrEmpty
    }
}

Describe 'End-to-end on the desktop' -Tag EndToEnd {
    BeforeAll {
        $script:E2eSkip = $null
        # It runs only in the process that run.ps1 -EndToEnd starts for it. The banner watches that
        # process and cleans up when it has ended, so the process must end when the run does: never a
        # person's own console.
        if ($env:OMB_E2E -ne '1' -or [Environment]::CommandLine -notmatch '(?i)-file\s+"?[^"]*run\.ps1') {
            $why = 'it takes the desktop, and runs only in a process of its own; run it with: powershell -NoProfile -File powershell\tests\run.ps1 -EndToEnd'
            # Under -Ci this can only mean that the check or the way the stage starts the test broke: the
            # suite fails rather than skip every case and leave a green build that ran none.
            if ($env:OMB_E2E_CI -eq '1') { throw "The end-to-end test cannot run in this process ($([Environment]::CommandLine)): $why." }
            $script:E2eSkip = $why
        }
        elseif (-not (Get-AhkExe)) {
            $why = "AutoHotkey v2 is not installed ($env:ProgramFiles\AutoHotkey\v2\AutoHotkey64.exe does not exist); it runs the AutoHotkey macropad, the stand-ins and the banner"
            # Under -Ci the agent must have it: the suite fails rather than skip every case.
            if ($env:OMB_E2E_CI -eq '1') { throw "The end-to-end test cannot run on this CI agent: $why." }
            $script:E2eSkip = $why
        }
        if ($script:E2eSkip) { return }

        Write-Host $script:E2eWarning
        $limit = 20; if ($env:OMB_E2E_LIMIT) { $limit = [int]$env:OMB_E2E_LIMIT }
        # The banner is up three seconds before the first key or change of the screen.
        [void](Start-E2eBanner (New-E2eRun -LimitMinutes $limit))
        # What an earlier run that did not end itself left (a crash, a Jenkins abort): the clean-up
        # touches only what each state file shows is still that run's.
        $left = Clear-E2eLeftovers
        if ($left.Problems.Count -gt 0) {
            $text = "The clean-up after an earlier run could not do everything: $($left.Problems -join '; ')"
            if ($env:OMB_E2E_CI -eq '1') { throw $text }
            Write-Warning $text
        }
        Install-E2eApp
        $twins = Get-E2eTwinChords
        $script:E2eCaseTable = [ordered]@{}
        foreach ($c in Get-E2eCases) {
            if (-not $c.Name) { $c.Name = $c.Command }
            if (-not $c.Kind) { $c.Kind = 'Chord' }
            if (-not $c.Chords -and $twins.ContainsKey($c.Command)) { $c.Chords = $twins[$c.Command] }
            if ($c.Kind -in 'Chord', 'Watch' -and -not $c.Chords) { throw "$($c.Command) has no one-chord PowerShell twin; give its case Chords and Source." }
            $script:E2eCaseTable[$c.Name] = $c
        }
        Write-E2eLayout @($script:E2eCaseTable.Values)
        Install-E2eLaunchers
        Install-E2eScripts
        $script:E2eRun.DesktopCount = Get-E2eDesktopCount
        if (-not [OmbE2e.KeyWatch]::Start()) { throw 'Could not install the key watch (a low-level keyboard hook).' }
        Stop-E2eOwnerMacropads
        [void](Start-E2eStandin 'A' -Exe 'chrome.exe' -X 40 -Y 120)
        [void](Start-E2eStandin 'B' -Exe 'e2eapp.exe' -X 500 -Y 120)
        [void](Start-E2eStandin 'C' -Exe 'e2eapp.exe' -X 500 -Y 320)
        [void](Start-E2eStandin 'P' -Exe 'putty.exe' -X 40 -Y 320)
    }
    AfterAll {
        if (-not $script:E2eSkip) { Complete-E2eRun }
    }

    Describe '<Title>' -ForEach $Langs {
        # Each case starts the macropad with the layout it is on when it is not already running.
        AfterAll {
            if (-not $script:E2eSkip) { Stop-E2eMacropad }
        }
        It '<Name>' -ForEach $Cases {
            if ($script:E2eSkip) { Set-ItResult -Skipped -Because $script:E2eSkip; return }
            $why = Invoke-E2eCase $script:E2eCaseTable[$Name] $Lang
            if ($why) { Set-ItResult -Skipped -Because $why }
        }
    }
}
