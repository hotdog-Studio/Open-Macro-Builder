# The two languages press the same keys. For each command that is one key chord in both languages,
# the AutoHotkey Send string and the PowerShell chord are read from the source text, turned into key
# events (ConvertFrom-AhkSend reads AutoHotkey's syntax, ConvertTo-KeyEvent reads a chord) and
# compared as the taps they make, such as 'Alt+Shift+Tab'. Two sources written apart must agree,
# so a wrong or mistyped chord on one side shows. (A PowerShell command that is several sends in a row, with
# nothing between them, counts as the taps of all of them.) A command that is not one chord on both sides
# (it starts a program, sends more than once, branches) must be in its pair's Skip list with the
# reason; the test fails on a command that is neither compared nor listed, and on a listed one whose
# version in either language only presses keys, so a skip cannot hide a disagreement. A chord sent only when a
# guard such as EnsureActiveOrOpenChrome says so is compared too, and so is the guard's name.
#
# To add a file pair, add an entry to $Pairs: Ahk and Ps are paths from the repository root.
BeforeDiscovery {
    $Pairs = @(
        @{ Name = 'media'; Ahk = 'ahk\commands\media.ahk'; Ps = 'powershell\commands\media.ps1'; Skip = @{} }
        @{ Name = 'power'; Ahk = 'ahk\commands\power.ahk'; Ps = 'powershell\commands\power.ps1'; Skip = @{
                TurnMonitorsOff = 'sends a window message to the desktop, not keys'
                Lock            = 'calls Windows to lock the computer'
                WinSleep        = 'calls Windows to sleep'
                Hibernate       = 'calls Windows to hibernate'
                Restart         = 'runs shutdown.exe'
                Shutdown        = 'runs shutdown.exe'
            }
        }
        @{ Name = 'windows'; Ahk = 'ahk\commands\windows.ahk'; Ps = 'powershell\commands\windows.ps1'; Skip = @{
                OpenFileExplorer  = 'activates or opens a program'
                OpenPowershell    = 'activates or opens a program'
                OpenCommandPrompt = 'activates or opens a program'
                OpenTaskManager   = 'activates or opens a program'
                OpenControlPanel  = 'starts a program'
                OpenSettings      = 'starts a program'
                OpenServices      = 'starts a program'
                SnippingTool      = 'starts a program'
            }
        }
        @{ Name = 'custom\examples'; Ahk = 'ahk\commands\custom\examples.ahk'; Ps = 'powershell\commands\custom\examples.ps1'; Skip = @{
                ExampleOpenWebsite = 'opens a web address in Chrome'
                ExampleOpenProgram = 'activates or opens a program'
                OpenCalculator     = 'activates or opens a program'
                ExampleOpenFolder  = 'opens a folder in File Explorer'
            }
        }
        @{ Name = 'custom\chrome'; Ahk = 'ahk\commands\custom\chrome.ahk'; Ps = 'powershell\commands\custom\chrome.ps1'; Skip = @{
                EnsureActiveOrOpenChrome = 'activates or opens Chrome'
                OpenYoutube              = 'opens a web address in Chrome'
                OpenGoogle               = 'opens a web address in Chrome'
                ChromeOpen               = 'activates or opens Chrome'
                ChromeOpenExtensions     = 'types an address into the address bar after a chord and a pause'
                ChromeOpenSettings       = 'types an address into the address bar after a chord and a pause'
            }
        }
        @{ Name = 'custom\ssh'; Ahk = 'ahk\commands\custom\ssh.ahk'; Ps = 'powershell\commands\custom\ssh.ps1'; Skip = @{
                SshMacroName        = 'starts PuTTY'
                SshMacroDescription = 'starts PuTTY'
                SshExample          = 'starts ssh'
            }
        }
        @{ Name = 'custom\vscode'; Ahk = 'ahk\commands\custom\vscode.ahk'; Ps = 'powershell\commands\custom\vscode.ps1'; Skip = @{
                VsCodeToggleZenMode  = 'two key presses with a pause between (Ctrl+K, Z)'
                VsCodeNextGroup      = 'two key presses with a pause between (Ctrl+K, Ctrl+Right)'
                VsCodePreviousGroup  = 'two key presses with a pause between (Ctrl+K, Ctrl+Left)'
                VsCodeMoveGroupLeft  = 'two key presses with a pause between (Ctrl+K, Left)'
                VsCodeMoveGroupRight = 'two key presses with a pause between (Ctrl+K, Right)'
            }
        }
        @{ Name = 'custom\vsstudio'; Ahk = 'ahk\commands\custom\vsstudio.ahk'; Ps = 'powershell\commands\custom\vsstudio.ps1'; Skip = @{} }
        # This pair compares no keys: both of its commands open a form and press nothing themselves, so
        # both are skipped. It is listed so that a new command in either file must be compared or skipped
        # with a reason. The forms' keys are tested in Automation.Tests.ps1.
        @{ Name = 'custom\automation'; Ahk ='ahk\commands\custom\automation.ahk'; Ps = 'powershell\commands\custom\automation.ps1'; Skip = @{
                ShowDelayedKeyForm   = 'opens a form; the key is chosen there'
                ShowDelayedClickForm = 'opens a form; the click is recorded there'
            }
        }
    )
}
BeforeAll {
    $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    foreach ($f in 'Input', 'AhkSyntax') { . "$root\powershell\lib\$f.ps1" }
    . "$PSScriptRoot\helpers\CommandSource.ps1"

    # name -> @{ Ahk = Send text or $null; Ps = chord or $null; InAhk; InPs } for the commands of a pair.
    function Get-PairCommand {
        param([string]$Ahk, [string]$Ps)
        $a = Get-AhkFunctionSource (Join-Path $root $Ahk)
        $p = Get-PsFunctionSource (Join-Path $root $Ps)
        $names = @(@($a.Keys | Where-Object { $a[$_].Params -eq 'Macro' }) + @($p.Keys | Where-Object { $p[$_].Params -eq 'Macro' })) | Sort-Object -Unique
        $result = [ordered]@{}
        foreach ($n in $names) {
            $sendText = $null; $chord = $null; $ahkGuard = ''; $psGuard = ''
            if ($a.Contains($n)) { $sendText = Get-AhkSingleSend $a[$n]; $ahkGuard = Get-AhkGuard $a[$n] }
            if ($p.Contains($n)) { $chord = $p[$n].Chord; $psGuard = $p[$n].Guard }
            $result[$n] = [pscustomobject]@{ Ahk = $sendText; Ps = $chord; AhkGuard = $ahkGuard; PsGuard = $psGuard }
        }
        $result
    }
}
Describe 'The two languages press the same keys: <Name>' -ForEach $Pairs {
    It 'compares every command or lists why not' {
        $commands = Get-PairCommand $Ahk $Ps
        $bad = foreach ($n in $commands.Keys) {
            $comparable = $null -ne $commands[$n].Ahk -and $null -ne $commands[$n].Ps
            if (-not $comparable -and -not $Skip.ContainsKey($n)) { "$n is not one chord in both languages and is not in the Skip list" }
            if ($comparable -and $Skip.ContainsKey($n)) { "$n is one chord in both languages; take it out of the Skip list" }
            elseif ($Skip.ContainsKey($n) -and ($null -ne $commands[$n].Ahk -or $null -ne $commands[$n].Ps)) {
                # A skip must not hide a command that became a chord on one side only.
                $side = if ($null -ne $commands[$n].Ahk) { "AutoHotkey Send(`"$($commands[$n].Ahk)`")" } else { "PowerShell '$($commands[$n].Ps -join "', '")'" }
                "$n is skipped, but its $side only presses keys; compare it instead"
            }
        }
        $bad += foreach ($n in $Skip.Keys) { if (-not $commands.Contains($n)) { "$n in the Skip list is not a command of the pair" } }
        $bad | Should -BeNullOrEmpty
    }
    It 'presses the same keys in both languages' {
        $commands = Get-PairCommand $Ahk $Ps
        $compared = 0
        $bad = foreach ($n in $commands.Keys) {
            $c = $commands[$n]
            if ($null -eq $c.Ahk -or $null -eq $c.Ps) { continue }
            $compared++
            try {
                $ahkTaps = (ConvertTo-ChordTap (ConvertFrom-AhkSend $c.Ahk).Events) -join ', '
                $psTaps = (@(foreach ($chord in $c.Ps) { foreach ($tap in (ConvertTo-ChordTap (ConvertTo-KeyEvent $chord))) { $tap } })) -join ', '
                if ($ahkTaps -ne $psTaps) { "$n`: AutoHotkey Send(`"$($c.Ahk)`") presses $ahkTaps; PowerShell '$($c.Ps -join "', '")' presses $psTaps" }
                if ($c.AhkGuard -ne $c.PsGuard) { "$n`: AutoHotkey sends only if '$($c.AhkGuard)' says so; PowerShell only if '$($c.PsGuard)' says so" }
            } catch { "$n`: $($_.Exception.Message)" }
        }
        $bad | Should -BeNullOrEmpty
        if ($Skip.Count -eq 0 -or $compared -gt 0) { $compared | Should -BeGreaterThan 0 }
    }
}
