# Whose a process is, as the end-to-end test's clean-up decides it (helpers\EndToEnd.ps1). The clean-up
# ends processes with Stop-Process -Force and removes a run's folder, on a developer's desktop too:
# every end-to-end run starts with it. These are unit tests with everything that acts mocked: the list
# of processes, Stop-Process, the start of Windows, the banner, the waits and the held keys. They end
# no process, show no window, press no key, and remove no folder but one in TestDrive, so they run in
# the normal suite, not under the EndToEnd tag.
BeforeAll {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    foreach ($f in 'Native', 'Interop', 'Pump', 'Input', 'AhkSyntax', 'WinTitle', 'WindowOps', 'Window') { . "$root\powershell\lib\$f.ps1" }
    . "$PSScriptRoot\helpers\Ahk.ps1"
    . "$PSScriptRoot\helpers\CommandSource.ps1"
    . "$PSScriptRoot\helpers\EndToEnd.ps1"

    # One row as Get-E2eRunProcesses gives it: a process working in the folder, started at Start (UTC
    # ticks; 0 when that cannot be read).
    function New-E2eTestRow {
        param([int]$Id, [long]$Start)
        [pscustomobject]@{ Name = "p$Id.exe"; ProcessId = $Id; ParentProcessId = 1; ExecutablePath = "C:\Programs\p$Id.exe"; CommandLine = "p$Id.exe"; StartTicks = $Start; WorkingIn = 'C:\run' }
    }
    # One row as Get-CimInstance Win32_Process gives it.
    function New-E2eCimRow {
        param([int]$Id, [int]$Parent, [string]$Exe)
        [pscustomobject]@{ Name = (Split-Path $Exe -Leaf); ProcessId = $Id; ParentProcessId = $Parent; ExecutablePath = $Exe; CommandLine = $Exe; CreationDate = [DateTime]::new(2026, 11, 19, 3, 0, 0, [DateTimeKind]::Utc) }
    }
    $script:Minute = 600000000L
}

Describe 'End-to-end clean-up: the processes of a run folder' {
    BeforeEach {
        $script:Dir = Join-Path $TestDrive "omb-e2e-$(Get-Random)"
        [void](New-Item -ItemType Directory -Path $script:Dir)
        $script:Boot = [DateTime]::new(2026, 11, 19, 1, 0, 0, [DateTimeKind]::Utc).Ticks
        $script:TestStart = $script:Boot + 60 * $script:Minute
        $script:Done = [System.Collections.Generic.List[string]]::new()
        $script:Problems = [System.Collections.Generic.List[string]]::new()
        Mock Test-E2eRunAlive { $false }
        Mock Get-E2eBootTicks { $script:Boot }
        Mock Get-E2eDesktops { @() }
        Mock Show-E2eCleanupBanner { }
        Mock Wait-ScreenChange { }
        Mock Wait-E2eCondition { $true }
        Mock Clear-E2eHeldKeys { }
        Mock Start-E2eRecordedMacropad { 'already running' }
        Mock Get-CimInstance { [pscustomobject]@{ ParentProcessId = 0 } }
        Mock Stop-Process { }
        # A person's shell that stood in the folder before the run's test started, a program a command
        # started during the run, and one whose start cannot be read.
        $script:Before = New-E2eTestRow 101 ($script:TestStart - $script:Minute)
        $script:After = New-E2eTestRow 102 ($script:TestStart + $script:Minute)
        $script:Unknown = New-E2eTestRow 103 0
        Mock Get-E2eRunProcesses { @($script:Before, $script:After, $script:Unknown) }
    }
    It 'ends what started after the run''s test did, and leaves alone what started before it or cannot be told' {
        [System.IO.File]::WriteAllLines((Join-Path $script:Dir 'state.txt'), [string[]]@("test 4242 $script:TestStart", "boot $script:Boot"))
        Clear-E2eFolder $script:Dir $script:Done $script:Problems
        Should -Invoke Stop-Process -Times 1 -Exactly -ParameterFilter { $Id -contains 102 }
        Should -Invoke Stop-Process -Times 0 -Exactly -ParameterFilter { $Id -contains 101 -or $Id -contains 103 }
    }
    It 'removes the folder, and ends nothing, when nothing in it started after the run''s test did' {
        Mock Get-E2eRunProcesses { @($script:Before, $script:Unknown) }
        [System.IO.File]::WriteAllLines((Join-Path $script:Dir 'state.txt'), [string[]]@("test 4242 $script:TestStart", "boot $script:Boot"))
        Clear-E2eFolder $script:Dir $script:Done $script:Problems
        Should -Invoke Stop-Process -Times 0 -Exactly
        Test-Path -LiteralPath $script:Dir | Should -BeFalse -Because "nothing left to do (problems: $($script:Problems -join '; '))"
    }
    It 'ends nothing when the state does not say when Windows had started, and says so' {
        [System.IO.File]::WriteAllLines((Join-Path $script:Dir 'state.txt'), [string[]]@("test 4242 $script:TestStart"))
        Clear-E2eFolder $script:Dir $script:Done $script:Problems
        Should -Invoke Stop-Process -Times 0 -Exactly
        ($script:Problems -join "`n") | Should -Match 'does not say when Windows had started'
    }
    It 'ends nothing of a run from before Windows last started' {
        [System.IO.File]::WriteAllLines((Join-Path $script:Dir 'state.txt'), [string[]]@("test 4242 $($script:TestStart - 1440 * $script:Minute)", "boot $($script:Boot - 1440 * $script:Minute)"))
        Clear-E2eFolder $script:Dir $script:Done $script:Problems
        Should -Invoke Stop-Process -Times 0 -Exactly
        ($script:Done -join "`n") | Should -Match 'before Windows last started'
    }
}

Describe 'End-to-end clean-up: what an earlier build left in a Jenkins workspace' {
    BeforeEach {
        $script:Base = [DateTime]::new(2026, 11, 19, 3, 0, 0, [DateTimeKind]::Utc).Ticks
        $script:Mine = $script:Base
        $script:Done = [System.Collections.Generic.List[string]]::new()
        $script:Problems = [System.Collections.Generic.List[string]]::new()
        Mock Get-E2eStartTicks { $script:Mine }
        Mock Show-E2eCleanupBanner { }
        Mock Wait-ScreenChange { }
        Mock Wait-E2eCondition { $true }
        Mock Stop-Process { }
        Mock Get-E2eRunProcesses { @((New-E2eTestRow 201 ($script:Base - $script:Minute)), (New-E2eTestRow 202 ($script:Base + $script:Minute)), (New-E2eTestRow 203 0)) }
    }
    It 'ends only what started before the clean-up did, and reports what it cannot tell' {
        Clear-E2eWorkspace 'C:\ws' $script:Done $script:Problems
        Should -Invoke Stop-Process -Times 1 -Exactly -ParameterFilter { $Id -contains 201 }
        Should -Invoke Stop-Process -Times 0 -Exactly -ParameterFilter { $Id -contains 202 -or $Id -contains 203 }
        ($script:Problems -join "`n") | Should -Match 'p203\.exe 203'
    }
    It 'ends nothing when its own start cannot be read' {
        $script:Mine = 0
        Clear-E2eWorkspace 'C:\ws' $script:Done $script:Problems
        Should -Invoke Stop-Process -Times 0 -Exactly
        $script:Problems.Count | Should -Be 3
    }
}

Describe 'End-to-end clean-up: the processes in a folder never include the caller or its ancestors' {
    BeforeEach {
        # This process runs in a shell started by a build step that runs from the workspace, under an
        # agent that works in it. Two others are in the folder; one is elsewhere.
        $script:Table = @(
            (New-E2eCimRow $PID 9001 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe')
            (New-E2eCimRow 9001 9002 'C:\ws\tools\step.exe')
            (New-E2eCimRow 9002 4 'C:\java\java.exe')
            (New-E2eCimRow 9100 1 'C:\ws\left\stray.exe')
            (New-E2eCimRow 9200 1 'C:\Windows\System32\cmd.exe')
            (New-E2eCimRow 9300 1 'C:\Windows\System32\notepad.exe')
        )
        $script:Cwd = @{ $PID = 'C:\ws\'; 9001 = 'C:\ws'; 9002 = 'C:\ws\sub'; 9100 = 'C:\ws'; 9200 = 'C:\ws\build'; 9300 = 'C:\other' }
        Mock Get-CimInstance { $script:Table }
        Mock Get-E2eWorkingDirectory { $script:Cwd[$Id] }
    }
    It 'lists what runs from the folder or works in it, but not this process or one it descends from' {
        $found = @(Get-E2eRunProcesses 'C:\ws' -OrWorkingIn)
        (@($found | ForEach-Object { [int]$_.ProcessId } | Sort-Object) -join ',') | Should -Be '9100,9200'
    }
}
