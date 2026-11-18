# The cases of the end-to-end test (EndToEnd.Tests.ps1): one table, run once against each macropad.
#
# A case is a hashtable:
#   Command   the command function its key runs: a command of the shared files, or one of the test's
#             own (ahk\tests\e2e\commands.ahk / .ps1), whose names start with E2e
#   Name      the case's name when a command has more than one case (default: Command)
#   File      the shared command file it belongs to ('custom\vscode'), or 'e2e' for the test's own
#   Kind      'Chord' (default): the stand-in A is active (or From is, see below), the key is pressed,
#             and A must receive exactly the taps of Chords, as window messages.
#             'Watch': the keys are seen by the key watch, a low-level hook that also keeps Windows
#             from acting on them; for keys Windows takes before any window gets them.
#             'Custom': Arrange and Assert say what happens.
#   Chords    what a Chord or Watch case must press. Left out, it is the PowerShell twin's chord, read
#             from powershell\commands; ConvertTo-KeyEvent turns it into keys on the active window's
#             keyboard layout, so a symbol key is the one that types it there.
#   Source    for Chords written here: the documentation page that says these are the keys
#   From      for a Chord case: the stand-in that is active when the key is pressed ('B'); the command
#             must bring its program (A, which runs as chrome.exe) forward before it sends
#   Only      'ahk' or 'ps' when the case runs against one macropad only; Why says why
#   SkipIf    a scriptblock giving a reason to skip on this desktop, or nothing
#   Macro     @{ name; description } for the layout entry, when the command reads them
#   Targets   programs whose windows the case expects in front (not a person's interference)
#   Arrange, Assert, CleanUp   scriptblocks given the case's context ($ctx: Case, Lang, Run, ...)
#   Covers    the fixes of fix-scripts-1-report.md / fix-scripts-2-report.md it proves
#
# The stand-ins: A (40,120) runs as chrome.exe; B (500,120) and C (500,320) run as e2eapp.exe. The
# launcher (ahk\tests\e2e\launcher.cs) is first on the macropad's PATH as chrome.exe, putty.exe,
# ssh.exe and e2eapp.exe: a command that starts one of them starts a stand-in, and launches.log says
# with which arguments. No real Chrome, PuTTY, ssh, VS Code or Visual Studio is used.

$script:E2eDocs = @{
    VsCode   = 'https://code.visualstudio.com/docs/reference/default-keybindings'
    VsStudio = 'https://learn.microsoft.com/en-us/visualstudio/ide/default-keyboard-shortcuts-in-visual-studio'
    Chrome   = 'https://support.google.com/chrome/answer/157179'
    Windows  = 'https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec'
}

# ---- Pieces the cases share ----

# B is active, A behind it: a command that brings Chrome (A) forward has something to do.
$script:E2eFromB = { param($ctx) [void](Use-E2eStandin 'A'); [void](Use-E2eStandin 'B'); $ctx.Launches = Get-E2eLaunchMark; $ctx.Marks = @(Get-E2eMarks).Count }

# The command opened a web address in Chrome: the launcher, as chrome.exe from the run's PATH folder,
# got the address whole as its one argument; no cmd.exe was started; a Chrome window of the run is in front.
function Assert-E2eChromeUrl {
    param($ctx, [string]$Url)
    $launch = Wait-E2eCondition { Get-E2eLaunches $ctx.Launches | Where-Object { $_.Exe -like '*\path\chrome.exe' } | Select-Object -First 1 } -TimeoutMs 6000
    $launch | Should -Not -BeNullOrEmpty -Because "the command must start chrome.exe (the run's stand-in, first on the macropad's PATH)"
    $launch.Arguments.Trim('"') | Should -BeExactly $Url
    $front = Wait-E2eCondition { $i = Get-WindowInfo ([Macropad.WindowApi]::Foreground()); if ($i.Exe -eq 'chrome.exe' -and $i.Path -like "$($ctx.Run.Dir)*") { $i } } -TimeoutMs 6000
    $front | Should -Not -BeNullOrEmpty -Because "a Chrome window must come forward (in front: $(Get-E2eForegroundText))"
    Assert-E2eNoCmd
}

# No cmd.exe was started by the macropad under test (the old helpers went through cmd /c start).
function Assert-E2eNoCmd {
    $children = @(Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe' AND ParentProcessId = $($script:E2eRun.Macropad.Process.Id)")
    $children.Count | Should -Be 0 -Because 'the command must start the program itself, not through cmd.exe'
}

# The command started the program Exe (the launcher from the run's PATH folder) with exactly these
# arguments, without cmd.exe, and a window of that program came forward.
function Assert-E2eLaunch {
    param($ctx, [string]$Exe, [string]$Arguments, [int]$TimeoutMs = 8000)
    $launch = Wait-E2eCondition { Get-E2eLaunches $ctx.Launches | Where-Object { $_.Exe -like "*\path\$Exe" } | Select-Object -First 1 } -TimeoutMs $TimeoutMs
    $launch | Should -Not -BeNullOrEmpty -Because "the command must start $Exe (the run's stand-in, first on the macropad's PATH)"
    $launch.Arguments | Should -BeExactly $Arguments
    $front = Wait-E2eCondition { $i = Get-WindowInfo ([Macropad.WindowApi]::Foreground()); if ($i.Exe -eq $Exe -and $i.Path -like "$($ctx.Run.Dir)*") { $i } } -TimeoutMs $TimeoutMs
    $front | Should -Not -BeNullOrEmpty -Because "a window of $Exe must come forward (in front: $(Get-E2eForegroundText))"
    Assert-E2eNoCmd
}

# Every window that fits the WinTitles, hidden ones too, top of the screen first, with whether it is
# visible and whether Windows cloaks it (keeps it off the screen although it counts as visible): for
# a failure message.
function Get-E2eWindowReport {
    param([string[]]$WinTitle)
    $all = foreach ($t in $WinTitle) { foreach ($h in (Find-Window $t -All -IncludeHidden)) { $h } }
    (@($all | ForEach-Object { $i = Get-WindowInfo $_; "$($_) '$($i.Title)' $($i.Class) visible=$($i.Visible) cloaked=$([OmbE2e.Dwm]::Cloaked($_))" }) -join '; ')
}

# The folder a File Explorer window shows, from the Shell's list of its windows; $null when unknown.
function Get-E2eExplorerFolder {
    param([IntPtr]$Hwnd)
    foreach ($w in (New-Object -ComObject Shell.Application).Windows()) {
        try { if ([long]$w.HWND -eq $Hwnd.ToInt64()) { return $w.Document.Folder.Self.Path } } catch { $null = $_ }
    }
    $null
}

$script:E2eStopLaunched = { param($ctx) Stop-E2eLaunched }

# A message box of the macropad's with this title came forward and says Text.
function Assert-E2eMessageBox {
    param($ctx, [string]$Title, [string]$Text)
    $winTitle = "$Title ahk_class #32770 ahk_pid $($ctx.Run.Macropad.Process.Id)"
    $ctx.Window = Wait-E2eNewWindow $winTitle -TimeoutMs 5000
    $ctx.Window | Should -Not -BeNullOrEmpty -Because "a message box titled '$Title' must open"
    $active = Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $ctx.Window } -TimeoutMs 3000
    $active | Should -BeTrue -Because "the message box must come forward, where the keyboard is (in front: $(Get-E2eForegroundText))"
    Get-E2eStatusText $ctx.Window $Text | Should -BeExactly $Text
}

# True when Show Desktop is in effect: the window is minimized, or the desktop itself is in front.
function Test-E2eDesktopShown {
    param([IntPtr]$Hwnd)
    if ([Macropad.WindowApi]::IsMinimized($Hwnd)) { return $true }
    (Get-WindowInfo ([Macropad.WindowApi]::Foreground())).Class -in 'WorkerW', 'Progman'
}

# The work area (the screen less the taskbar) of the monitor a window is on.
function Get-E2eWorkArea {
    param([IntPtr]$Hwnd)
    [System.Windows.Forms.Screen]::FromHandle($Hwnd).WorkingArea
}

# True when the window's rectangle is the part of its monitor's work area that Part names (Left,
# Right, Top, Bottom: that half), give or take the invisible borders Windows puts round a window.
function Test-E2eSnapped {
    param([IntPtr]$Hwnd, [ValidateSet('Left', 'Right', 'Top', 'Bottom')][string]$Part)
    $w = Get-E2eWorkArea $Hwnd
    $r = Get-WindowRect $Hwnd
    $want = switch ($Part) {
        'Left' { @($w.X, $w.Y, [int]($w.Width / 2), $w.Height) }
        'Right' { @(($w.X + [int]($w.Width / 2)), $w.Y, [int]($w.Width / 2), $w.Height) }
        'Top' { @($w.X, $w.Y, $w.Width, [int]($w.Height / 2)) }
        'Bottom' { @($w.X, ($w.Y + [int]($w.Height / 2)), $w.Width, [int]($w.Height / 2)) }
    }
    $got = @($r.X, $r.Y, $r.Width, $r.Height)
    for ($i = 0; $i -lt 4; $i++) { if ([math]::Abs($got[$i] - $want[$i]) -gt 24) { return $false } }
    $true
}

# Puts A back where the run placed it, as a normal window, and in front.
function Reset-E2eStandinA {
    $a = $script:E2eRun.Standins['A']
    if ((Get-WindowState $a.Hwnd) -ne 'Normal') { Wait-ScreenChange; Set-WindowState $a.Hwnd Restore }
    $r = Get-WindowRect $a.Hwnd
    if ($r.X -ne $a.Rect.X -or $r.Y -ne $a.Rect.Y -or $r.Width -ne $a.Rect.Width -or $r.Height -ne $a.Rect.Height) {
        Wait-ScreenChange
        Move-Window $a.Hwnd $a.Rect.X $a.Rect.Y $a.Rect.Width $a.Rect.Height
    }
    [void](Use-E2eStandin 'A')
}

# Something of Windows' own shell that a key brought up over A (Snap Assist, Task View, the screen
# capture), closed with Escape as a person would.
function Close-E2eShellOverlay {
    $a = $script:E2eRun.Standins['A'].Hwnd
    for ($i = 0; $i -lt 3 -and [Macropad.WindowApi]::Foreground() -ne $a; $i++) {
        $exe = (Get-WindowInfo ([Macropad.WindowApi]::Foreground())).Exe
        if ($exe -notin 'explorer.exe', 'ScreenClippingHost.exe', 'SnippingTool.exe', 'ShellExperienceHost.exe', 'ShellHost.exe') { break }
        Wait-ScreenChange
        Send-E2eChord 'Escape'
        [void](Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $a } -TimeoutMs 1500)
    }
}

# A window-placement case on A: the key must leave A as Test says, then A goes back.
function New-E2ePlacementCase {
    param([string]$Command, [scriptblock]$Test, [string]$Expect, [scriptblock]$SkipIf, [string]$Covers)
    @{ Command = $Command; File = 'windows'; Kind = 'Custom'; SkipIf = $SkipIf; Covers = $Covers; Expect = $Expect; Test = $Test; Targets = 'explorer.exe'
        Arrange = { param($ctx) Reset-E2eStandinA }
        Assert  = {
            param($ctx)
            $a = $ctx.Run.Standins['A'].Hwnd
            (Wait-E2eCondition { & $ctx.Case.Test $a } -TimeoutMs 4000) | Should -BeTrue -Because "the active window must be $($ctx.Case.Expect) (now: $((Get-WindowRect $a) | Out-String) state $(Get-WindowState $a))"
            Wait-ScreenChange -Observed
        }
        CleanUp = { param($ctx) Close-E2eShellOverlay; Reset-E2eStandinA }
    }
}

# The form a command opened (the macropad's own window with this title), active.
function Wait-E2eForm {
    param([string]$Title)
    $form = Wait-E2eNewWindow "$Title ahk_pid $($script:E2eRun.Macropad.Process.Id)" -Active -TimeoutMs 8000
    if ($null -eq $form) { throw "The form '$Title' did not open and come forward (in front: $(Get-E2eForegroundText))." }
    $form
}

# The text boxes of a form, in order (an AutoHotkey Edit, a WinForms ...EDIT... class).
function Get-E2eEdits {
    param([IntPtr]$Form)
    , @([Macropad.WindowApi]::Children($Form) | Where-Object { [Macropad.WindowApi]::ClassName($_) -match '(?i)edit' })
}

function Invoke-E2eButton {
    param([IntPtr]$Form, [string]$Text)
    [void](Send-WindowMessage (Find-Control $Form $Text) 0xF5 -Post)  # BM_CLICK
}

# The text of the form's control that starts with Prefix (a status line), or ''.
function Get-E2eStatusText {
    param([IntPtr]$Form, [string]$Prefix)
    foreach ($c in [Macropad.WindowApi]::Children($Form)) {
        $t = Get-ControlText $c
        if ($t.StartsWith($Prefix)) { return $t }
    }
    ''
}

# A program a command opened, found by WinTitles: it must come forward within the time, and a second
# press, made from B, must bring the same window forward without opening another.
function New-E2eOpenerCase {
    param([string]$Command, [string]$File, [string[]]$WinTitle, [string[]]$Targets, [switch]$SecondPress, [scriptblock]$SkipIf, [string]$Covers, [int]$TimeoutMs = 10000, [string]$Shell)
    $titles = $WinTitle
    $case = @{
        Command = $Command; File = $File; Kind = 'Custom'; Targets = $Targets; Covers = $Covers
        SkipIf  = $SkipIf
        Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Before = Get-E2eWindows $ctx.Case.WinTitle; $ctx.Started = Get-Date }
        Assert  = {
            param($ctx)
            $ctx.Window = Wait-E2eNewWindow $ctx.Case.WinTitle -Before $ctx.Before -Active -TimeoutMs $ctx.Case.TimeoutMs
            $ctx.Window | Should -Not -BeNullOrEmpty -Because "a window that fits '$($ctx.Case.WinTitle -join "' or '")' must open and come forward (in front: $(Get-E2eForegroundText))"
            if ($ctx.Case.SecondPress) {
                [void](Use-E2eStandin 'B')
                Wait-ScreenChange
                Invoke-E2eMacroKey $ctx.Case.Slot
                $again = Wait-E2eCondition { if ([Macropad.WindowApi]::Foreground() -eq $ctx.Window) { $true } } -TimeoutMs 6000
                $again | Should -BeTrue -Because "a second press must bring the same window forward (in front: $(Get-E2eForegroundText); windows that fit, hidden ones too: $(Get-E2eWindowReport $ctx.Case.WinTitle))"
                Wait-Pump 1000
                # PseudoConsoleWindow is the helper window Windows makes for a shell that Windows Terminal
                # shows (ConPTY); it belongs to the first press's shell, not to a second one.
                $new = @(foreach ($w in (Get-E2eWindows $ctx.Case.WinTitle)) { if ($ctx.Before -notcontains $w -and $w -ne $ctx.Window -and [Macropad.WindowApi]::ClassName($w) -ne 'PseudoConsoleWindow') { $w } })
                if ($ctx.Case.Shell) {
                    # Shells started since the case began by the macropad or by Windows Terminal (not by
                    # whatever else runs on this PC).
                    $parents = @($ctx.Run.Macropad.Process.Id) + @(Get-Process WindowsTerminal, OpenConsole -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
                    $shells = @(Get-CimInstance Win32_Process -Filter "Name = '$($ctx.Case.Shell)'" | Where-Object { $_.CreationDate -gt $ctx.Started -and $_.ProcessId -ne $ctx.Run.Macropad.Process.Id -and $parents -contains [int]$_.ParentProcessId })
                    $shells.Count | Should -Be 1 -Because "two presses must start one $($ctx.Case.Shell) (a second Terminal tab would be a second one)"
                }
                $new.Count | Should -Be 0 -Because "a second press must not open another window (new: $(($new | ForEach-Object { $i = Get-WindowInfo $_; "'$($i.Title)' $($i.Exe) $($i.Class)" }) -join ', '); the first: '$((Get-WindowInfo $ctx.Window).Title)' $((Get-WindowInfo $ctx.Window).Class))"
            }
        }
        CleanUp = { param($ctx) if ($ctx.Window) { Close-E2eWindow $ctx.Window } }
    }
    $case.WinTitle = $titles
    $case.SecondPress = [bool]$SecondPress
    $case.Shell = $Shell
    $case.TimeoutMs = $TimeoutMs
    $case
}

$script:E2eExplorer = 'ahk_class CabinetWClass'

# ---- The table ----

# -All gives every case, also when OMB_E2E_CASE (run.ps1 -Case) picks some.
function Get-E2eCases {
    param([switch]$All)
    $cases = @(
        # ======== The fixes no test proved (fix-scripts-1-report.md and fix-scripts-2-report.md) ========

        @{ Command = 'E2eRunScripts'; File = 'e2e'; Kind = 'Custom'; Covers = 'AHK-1, AHK-2 (fix 1: items 1-3)'
            Arrange = {
                param($ctx)
                [void](Use-E2eStandin 'B')
                $ctx.Dir = Join-Path $ctx.Run.Dir 'E2E Test'
                Get-ChildItem -LiteralPath $ctx.Dir -Filter '*-out*.txt' | Remove-Item -Force
                $ctx.Marks = @(Get-E2eMarks).Count
            }
            Assert  = {
                param($ctx)
                $want = [ordered]@{ 'py-out.txt' = '--quick a&b'; 'ps-out-args.txt' = 'one|two'; 'ps-out-none.txt' = '|'; 'bat-out-many.txt' = 'one|two|three'; 'bat-out-.txt' = '0||' }
                [void](Wait-E2eMark $ctx.Marks 'scripts started' -TimeoutMs 20000)
                $all = Wait-E2eCondition { -not ($want.Keys | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ctx.Dir $_)) }) } -TimeoutMs 10000
                foreach ($f in $want.Keys) {
                    $path = Join-Path $ctx.Dir $f
                    (Test-Path -LiteralPath $path) | Should -BeTrue -Because "$f must be written by its script"
                    ([System.IO.File]::ReadAllText($path)).Trim() | Should -BeExactly $want[$f] -Because "of what $f says the script was given"
                }
                [void]$all
                [void](Use-E2eStandin 'B')
            }
        }
        @{ Command = 'E2eAmpersand'; File = 'e2e'; Kind = 'Custom'; Covers = 'AHK-2 (fix 1: item 3a)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.File = Join-Path $ctx.Run.Dir 'E2E Test\amp.txt'; Remove-Item -LiteralPath $ctx.File -ErrorAction SilentlyContinue; $ctx.Marks = @(Get-E2eMarks).Count }
            Assert  = {
                param($ctx)
                $text = Wait-E2eCondition { if (Test-Path -LiteralPath $ctx.File) { [System.IO.File]::ReadAllText($ctx.File) } } -TimeoutMs 8000
                $text | Should -BeExactly 'a&b'
                [void](Wait-E2eMark $ctx.Marks 'ampersand done' -TimeoutMs 10000)
                Assert-E2eNoCmd
            }
        }
        @{ Command = 'E2eOpenSpaces'; File = 'e2e'; Kind = 'Custom'; Covers = 'AHK-2 (fix 1: item 4)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Launches = Get-E2eLaunchMark }
            Assert  = {
                param($ctx)
                $dir = Join-Path $ctx.Run.Dir 'E2E Test'
                $launch = Wait-E2eCondition { Get-E2eLaunches $ctx.Launches | Select-Object -First 1 } -TimeoutMs 6000
                $launch.Exe | Should -Be (Join-Path $dir 'e2e app.exe')
                $launch.Arguments | Should -BeExactly ('"{0}"' -f (Join-Path $dir 'note a.txt'))
                $w = Wait-E2eNewWindow 'ahk_exe e2e app.exe' -Active -TimeoutMs 6000
                $w | Should -Not -BeNullOrEmpty -Because "the program's window must come forward (in front: $(Get-E2eForegroundText))"
            }
            CleanUp = $script:E2eStopLaunched
        }
        @{ Command = 'E2eEnsureActive'; File = 'e2e'; Kind = 'Custom'; Covers = 'AHK-3, PS-8 (fix 1: items 5, 8)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'C'); [void](Use-E2eStandin 'B'); [void](Use-E2eStandin 'A'); $ctx.Marks = @(Get-E2eMarks).Count }
            Assert  = {
                param($ctx)
                Wait-E2eMark $ctx.Marks 'ensure *' | Should -Be 'ensure 1'
                [Macropad.WindowApi]::Foreground() | Should -Be $ctx.Run.Standins['B'].Hwnd -Because 'the top window of the program comes forward'
            }
        }
        @{ Command = 'E2eNeverAppears'; File = 'e2e'; Kind = 'Custom'; Covers = 'AHK-4, PS-8 (fix 1: items 6, 8)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Marks = @(Get-E2eMarks).Count; $ctx.Launches = Get-E2eLaunchMark }
            Assert  = {
                param($ctx)
                Wait-E2eMark $ctx.Marks 'never *' -TimeoutMs 25000 | Should -Be 'never 0'
                @(Get-E2eLaunches $ctx.Launches).Count | Should -Be 3 -Because 'Open, ActivateOrOpen and EnsureActiveOrOpen each start the program'
                [Macropad.WindowApi]::Foreground() | Should -Be $ctx.Run.Standins['B'].Hwnd -Because 'nothing is activated when no window appears'
            }
        }
        @{ Command = 'E2eStep'; File = 'e2e'; Kind = 'Custom'; Covers = 'AHK-5 (fix 1: item 7)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'C'); [void](Use-E2eStandin 'B'); [void](Use-E2eStandin 'A') }
            Assert  = {
                param($ctx)
                $b = $ctx.Run.Standins['B'].Hwnd; $c = $ctx.Run.Standins['C'].Hwnd
                (Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $b } -TimeoutMs 6000) | Should -BeTrue -Because "the program's top window comes forward first (in front: $(Get-E2eForegroundText))"
                Wait-ScreenChange
                Invoke-E2eMacroKey $ctx.Case.Slot
                (Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $c } -TimeoutMs 6000) | Should -BeTrue -Because "a press while one of its windows is active brings the bottom one (in front: $(Get-E2eForegroundText))"
            }
        }
        (New-E2eOpenerCase 'OpenFileExplorer' 'windows' $script:E2eExplorer -Targets 'explorer.exe' -Covers 'AHK-8 (fix 1: item 11)' -SkipIf {
                $f = Get-E2eForeignWindows $script:E2eExplorer
                if ($f.Count -gt 0) { "File Explorer windows the test did not open are on the desktop ($($f -join ', ')); the key would bring one of them forward" }
            })
        @{ Command = 'ExampleOpenFolder'; File = 'custom\examples'; Kind = 'Custom'; Targets = 'explorer.exe'; Covers = 'AHK-17, PS-3 and the twin fix (fix 1: item 15)'
            Arrange = {
                param($ctx)
                # Another File Explorer window is active first: the new one must still come forward.
                $ctx.Before = Get-E2eWindows $script:E2eExplorer
                [void](Use-E2eStandin 'B')
                Wait-ScreenChange
                Start-Process explorer.exe -ArgumentList ('"{0}"' -f (Join-Path $ctx.Run.Dir 'E2E Test'))
                $ctx.Other = Wait-E2eNewWindow $script:E2eExplorer -Before $ctx.Before -TimeoutMs 8000
                if (-not $ctx.Other) { throw 'The test could not open the first File Explorer window.' }
                [void](Set-E2eActive $ctx.Other)
                $ctx.Before = Get-E2eWindows $script:E2eExplorer
            }
            Assert  = {
                param($ctx)
                $ctx.Window = Wait-E2eNewWindow $script:E2eExplorer -Before $ctx.Before -Active -TimeoutMs 8000
                $ctx.Window | Should -Not -BeNullOrEmpty -Because "a new File Explorer window must come forward (in front: $(Get-E2eForegroundText))"
                $shown = Wait-E2eCondition { Get-E2eExplorerFolder $ctx.Window } -TimeoutMs 5000
                $shown | Should -Be ([Environment]::GetFolderPath('MyDocuments'))
            }
            CleanUp = { param($ctx) foreach ($w in $ctx.Window, $ctx.Other) { if ($w) { Close-E2eWindow $w } } }
        }
        (New-E2eOpenerCase 'OpenPowershell' 'windows' @('ahk_exe powershell.exe', 'PowerShell ahk_exe WindowsTerminal.exe') -Targets 'powershell.exe', 'WindowsTerminal.exe', 'OpenConsole.exe', 'conhost.exe' -SecondPress -Shell 'powershell.exe' -Covers 'AHK-9, PS-2 (fix 1: item 12)' -SkipIf {
                $f = Get-E2eForeignWindows @('ahk_exe powershell.exe', 'PowerShell ahk_exe WindowsTerminal.exe')
                if ($f.Count -gt 0) { "PowerShell windows the test did not open are on the desktop ($($f -join ', ')); the key would bring one of them forward" }
            })
        (New-E2eOpenerCase 'OpenCommandPrompt' 'windows' @('ahk_exe cmd.exe', 'Command Prompt ahk_exe WindowsTerminal.exe', 'cmd.exe ahk_exe WindowsTerminal.exe') -Targets 'cmd.exe', 'WindowsTerminal.exe', 'OpenConsole.exe', 'conhost.exe' -SecondPress -Shell 'cmd.exe' -Covers 'AHK-9, PS-2 (fix 1: item 12)' -SkipIf {
                $f = Get-E2eForeignWindows @('ahk_exe cmd.exe', 'Command Prompt ahk_exe WindowsTerminal.exe', 'cmd.exe ahk_exe WindowsTerminal.exe')
                if ($f.Count -gt 0) { "Command Prompt windows the test did not open are on the desktop ($($f -join ', ')); the key would bring one of them forward" }
            })
        @{ Command = 'NextWindow'; File = 'windows'; Kind = 'Custom'; Covers = 'AHK-10 (fix 1: item 13)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); [void](Use-E2eStandin 'A') }
            Assert  = {
                param($ctx)
                $b = $ctx.Run.Standins['B'].Hwnd
                (Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $b } -TimeoutMs 4000) | Should -BeTrue -Because "Alt+Tab goes to the window used before (in front: $(Get-E2eForegroundText))"
            }
        }
        @{ Command = 'PreviousWindow'; File = 'windows'; Kind = 'Custom'; Covers = 'AHK-10 (fix 1: item 13)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'C'); [void](Use-E2eStandin 'B'); [void](Use-E2eStandin 'A') }
            Assert  = {
                param($ctx)
                # Alt+Shift+Tab goes to the other end of the list: the window used longest ago. On a
                # desktop with only the test's windows that is C; on a person's desktop, one of theirs.
                $a = $ctx.Run.Standins['A'].Hwnd; $b = $ctx.Run.Standins['B'].Hwnd; $c = $ctx.Run.Standins['C'].Hwnd
                $moved = Wait-E2eCondition { $f = [Macropad.WindowApi]::Foreground(); if ($f -ne $a -and $f -ne [IntPtr]::Zero) { $f } } -TimeoutMs 4000
                $moved | Should -Not -BeNullOrEmpty -Because 'another window must come forward'
                $moved | Should -Not -Be $b -Because 'B is where Alt+Tab goes, not Alt+Shift+Tab'
                $ours = @($ctx.Run.Standins.Values | ForEach-Object { $_.Hwnd })
                if ($ours -contains $moved) { $moved | Should -Be $c }
            }
            CleanUp = { param($ctx) [void](Use-E2eStandin 'A') }
        }
        (New-E2eOpenerCase 'OpenCalculator' 'custom\examples' 'Calculator ahk_exe ApplicationFrameHost.exe' -Targets 'ApplicationFrameHost.exe', 'CalculatorApp.exe' -SecondPress -Covers 'AHK-16, PS-1 (fix 1: item 14)' -SkipIf {
                if (-not (Get-AppxPackage Microsoft.WindowsCalculator -ErrorAction SilentlyContinue)) { return 'Calculator is not installed on this Windows' }
                $f = Get-E2eForeignWindows 'Calculator ahk_exe ApplicationFrameHost.exe'
                if ($f.Count -gt 0) { "a Calculator the test did not open is on the desktop; the key would bring it forward" }
            })
        @{ Command = 'E2eOpenFolderComma'; File = 'e2e'; Kind = 'Custom'; Only = 'ps'; Why = 'Open-ExplorerWindow is a PowerShell helper; the AutoHotkey version has none'; Targets = 'explorer.exe'; Covers = 'PS-9 (fix 1: item 16)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Before = Get-E2eWindows $script:E2eExplorer }
            Assert  = {
                param($ctx)
                $ctx.Window = Wait-E2eNewWindow $script:E2eExplorer -Before $ctx.Before -Active -TimeoutMs 8000
                $ctx.Window | Should -Not -BeNullOrEmpty -Because "a new File Explorer window must come forward (in front: $(Get-E2eForegroundText))"
                (Wait-E2eCondition { Get-E2eExplorerFolder $ctx.Window } -TimeoutMs 5000) | Should -Be (Join-Path $ctx.Run.Dir 'E2E Test\Smith, John')
            }
            CleanUp = { param($ctx) if ($ctx.Window) { Close-E2eWindow $ctx.Window } }
        }
        @{ Command = 'E2eChromeUrl'; File = 'e2e'; Kind = 'Custom'; Targets = 'chrome.exe'; Covers = 'AHK-2, AHK-12, AHK-13 (fix 2: items 1, 2)'
            Arrange = $script:E2eFromB
            Assert  = { param($ctx) Assert-E2eChromeUrl $ctx 'https://example.com/?a=1&b=2' }
            CleanUp = $script:E2eStopLaunched
        }
        @{ Command = 'ChromeOpen'; File = 'custom\chrome'; Kind = 'Custom'; Covers = 'fix 2: item 3'
            Arrange = $script:E2eFromB
            Assert  = {
                param($ctx)
                $a = $ctx.Run.Standins['A'].Hwnd
                (Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $a } -TimeoutMs 6000) | Should -BeTrue -Because "Chrome's window comes forward (in front: $(Get-E2eForegroundText))"
                @(Get-E2eLaunches $ctx.Launches).Count | Should -Be 0 -Because 'Chrome is not started again while it has a window'
            }
        }
        @{ Name = 'ChromeNewTab (Chrome shows no window)'; Command = 'ChromeNewTab'; File = 'custom\chrome'; Kind = 'Custom'; Covers = 'AHK-13, PS-8, N2 (fix 2: items 4, 5)'
            SkipIf  = {
                $f = Get-E2eForeignWindows 'ahk_exe chrome.exe'
                if ($f.Count -gt 0) { "a Chrome the test did not start has windows open; for this case Chrome must have none" }
            }
            Arrange = {
                param($ctx)
                $ctx.A = $ctx.Run.Standins['A']
                Wait-ScreenChange
                Set-WindowState $ctx.A.Hwnd Hide
                Set-Content -LiteralPath (Join-Path $ctx.Run.Dir 'nowindow-chrome') -Value ''
                $ctx.B = Use-E2eStandin 'B'
                $ctx.Mark = Get-E2eStandinMark $ctx.B
                $ctx.Launches = Get-E2eLaunchMark
            }
            Assert  = {
                param($ctx)
                # EnsureActiveOrOpen gives a window 5 seconds; nothing may be sent, then or after.
                Wait-Pump 6500
                @(Get-E2eLaunches $ctx.Launches).Count | Should -Be 1 -Because 'the command starts Chrome when it has no window'
                (Get-E2eWatchTaps) -join ', ' | Should -BeNullOrEmpty -Because 'no key may be sent when Chrome did not come forward'
                (Get-E2eStandinTaps $ctx.B $ctx.Mark) -join ', ' | Should -BeNullOrEmpty
                [Macropad.WindowApi]::Foreground() | Should -Be $ctx.B.Hwnd
            }
            CleanUp = {
                param($ctx)
                Remove-Item -LiteralPath (Join-Path $ctx.Run.Dir 'nowindow-chrome') -ErrorAction SilentlyContinue
                Wait-ScreenChange
                Set-WindowState $ctx.Run.Standins['A'].Hwnd Show
                Stop-E2eLaunched
            }
        }
        foreach ($c in 'ChromeNewTab', 'ChromeOpenNewWindow', 'ChromeOpenIncognitoWindow', 'ChromeOpenDownloads', 'ChromeOpenHistory', 'ChromeOpenBookmarks') {
            @{ Command = $c; File = 'custom\chrome'; From = 'B'; Covers = 'PS-8, N2 (fix 2: item 6)' }
        }
        @{ Command = 'ChromeOpenExtensions'; File = 'custom\chrome'; From = 'B'; Chords = @('Ctrl+l', 'text:chrome://extensions', 'Enter'); Source = $script:E2eDocs.Chrome; Covers = 'PS-10 (fix 2: item 7)' }
        @{ Command = 'ChromeOpenSettings'; File = 'custom\chrome'; From = 'B'; Chords = @('Ctrl+l', 'text:chrome://settings', 'Enter'); Source = $script:E2eDocs.Chrome; Covers = 'PS-10 (fix 2: item 7)' }
        @{ Command = 'SshMacroName'; File = 'custom\ssh'; Kind = 'Custom'; Macro = @{ name = 'e2e test' }; Targets = 'putty.exe'; Covers = 'AHK-15, AHK-13 (fix 2: item 9)'
            Arrange = $script:E2eFromB
            Assert  = { param($ctx) Assert-E2eLaunch $ctx 'putty.exe' '-load "e2e test"' -TimeoutMs 16000 }
            CleanUp = $script:E2eStopLaunched
        }
        foreach ($c in 'VsCodeRestartDebugging', 'VsCodePauseDebugging', 'VsCodePeekImplementations', 'VsCodeAddInlineBreakpoint', 'VsCodeSplitPanel', 'VsCodeOpenTerminal') {
            @{ Command = $c; File = 'custom\vscode'; Covers = 'AHK-22 to AHK-26 (fix 2: item 10)' }
        }
        @{ Command = 'VsStudioShowTestExplorer'; File = 'custom\vsstudio'; Covers = 'AHK-28, PS-7 (fix 2: item 12)' }
        @{ Command = 'ShowDelayedKeyForm'; File = 'custom\automation'; Kind = 'Custom'; Covers = 'AHK-19 (fix 2: item 14)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B') }
            Assert  = {
                param($ctx)
                $ctx.Form = Wait-E2eForm 'Send key after delay'
                $edits = Get-E2eEdits $ctx.Form
                $key = if ($ctx.Lang -eq 'ahk') { '{F7}' } else { 'F7' }
                Set-ControlText $edits[0] $key
                Set-ControlText $edits[1] '0'
                [OmbE2e.KeyWatch]::Clear()
                Wait-ScreenChange
                Invoke-E2eButton $ctx.Form 'Schedule'
                # A delay of 0 sends at once (it used to cancel the timer).
                $taps = Wait-E2eTaps { Get-E2eWatchTaps } 1 -TimeoutMs 1500 -SettleMs 300
                ($taps -join ', ') | Should -Be 'F7'
                [Macropad.WindowApi]::Visible($ctx.Form) | Should -BeFalse -Because 'Schedule hides the form'
            }
            CleanUp = { param($ctx) [void](Use-E2eStandin 'B') }
        }
        @{ Name = 'ShowDelayedKeyForm (records a key, lets go of the keyboard when closed)'; Command = 'ShowDelayedKeyForm'; File = 'custom\automation'; Kind = 'Custom'; Covers = 'AHK-18 (in part), AHK-20 (fix 2: items 13, 15), PS-11'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B') }
            Assert  = {
                param($ctx)
                $ctx.Form = Wait-E2eForm 'Send key after delay'
                $edits = Get-E2eEdits $ctx.Form
                Invoke-E2eButton $ctx.Form 'Record key'
                (Wait-E2eCondition { Get-E2eStatusText $ctx.Form 'Press a key' } -TimeoutMs 3000) | Should -Not -BeNullOrEmpty
                # AutoHotkey's form reads whether Ctrl, Shift and Alt are physically held, which a key sent
                # by a program never is; the PowerShell form reads them as the window does.
                if ($ctx.Lang -eq 'ahk') { Send-E2eChord 'F7'; $want = '{F7}' } else { Send-E2eChord 'Ctrl+Shift+t'; $want = 'Ctrl+Shift+t' }
                (Wait-E2eCondition { $t = Get-ControlText $edits[0]; if ($t -eq $want) { $t } } -TimeoutMs 3000) | Should -Be $want
                (Get-E2eStatusText $ctx.Form 'Recorded') | Should -Be "Recorded $want."
                # Record again and close the form while it waits for a key: the next key typed must
                # still reach the window it is typed in.
                Invoke-E2eButton $ctx.Form 'Record key'
                [void](Wait-E2eCondition { Get-E2eStatusText $ctx.Form 'Press a key' } -TimeoutMs 3000)
                Wait-ScreenChange
                [void][Macropad.WindowApi]::Post($ctx.Form, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)
                [void](Wait-E2eCondition { -not [Macropad.WindowApi]::Visible($ctx.Form) -or -not [Macropad.WindowApi]::Exists($ctx.Form) } -TimeoutMs 3000)
                Wait-ScreenChange -Observed
                $b = Use-E2eStandin 'B'
                $mark = Get-E2eStandinMark $b
                Send-E2eChord 'a'
                $taps = Wait-E2eTaps { Get-E2eStandinTaps $b $mark } 1 -TimeoutMs 2000
                ($taps -join ', ') | Should -Be 'a' -Because 'a recording the form left running would hold the key back'
            }
        }
        @{ Command = 'ShowDelayedClickForm'; File = 'custom\automation'; Kind = 'Custom'; Covers = 'AHK-19 (fix 2: item 14, the click form)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Mouse = [OmbE2e.Input]::MousePosition() }
            Assert  = {
                param($ctx)
                $ctx.Form = Wait-E2eForm 'Click after delay'
                Invoke-E2eButton $ctx.Form 'Record click'
                (Wait-E2eCondition { Get-E2eStatusText $ctx.Form 'Click a mouse button' } -TimeoutMs 3000) | Should -Not -BeNullOrEmpty
                $b = $ctx.Run.Standins['B']
                $r = Get-WindowRect $b.Hwnd
                $x = $r.X + 200; $y = $r.Y + 110
                Send-E2eClick $x $y
                (Wait-E2eCondition { Get-E2eStatusText $ctx.Form 'Captured' } -TimeoutMs 3000) | Should -Be "Captured Left click at $x, $y."
                $mark = Get-E2eStandinMark $b
                Set-ControlText (Get-E2eEdits $ctx.Form)[0] '0'
                Wait-ScreenChange
                Invoke-E2eButton $ctx.Form 'Schedule'
                $click = Wait-E2eCondition { Get-E2eStandinEvents $b $mark | Where-Object Kind -eq 'click' | Select-Object -First 1 } -TimeoutMs 2000
                $click | Should -Not -BeNullOrEmpty -Because "the recorded click is replayed at once with a delay of 0 (B's log since the first click: $((@(Read-E2eLog $b.Log) | Select-Object -Skip ($mark - 2)) -join ' / '); form visible: $([Macropad.WindowApi]::Visible($ctx.Form)))"
                $click.Line | Should -Match '^click left '
            }
            CleanUp = { param($ctx) if ($ctx.Mouse) { [void][OmbE2e.Input]::MoveMouse($ctx.Mouse[0], $ctx.Mouse[1]) } }
        }

        # ======== The rest of the shared commands, file by file ========

        # ---- helper ----
        @{ Command = 'Message'; File = 'helper'; Kind = 'Custom'; Macro = @{ name = 'E2E message'; description = 'Message shows this text' }
            Arrange = { param($ctx) [void](Use-E2eStandin 'B') }
            Assert  = { param($ctx) Assert-E2eMessageBox $ctx 'E2E message' 'Message shows this text' }
            CleanUp = { param($ctx) if ($ctx.Window) { Close-E2eWindow $ctx.Window } }
        }
        @{ Command = 'ReplaceMe'; File = 'helper'; Kind = 'Custom'; Macro = @{ name = 'E2E replace' }
            Arrange = { param($ctx) [void](Use-E2eStandin 'B') }
            Assert  = { param($ctx) Assert-E2eMessageBox $ctx 'E2E replace' 'Replace E2E replace with your own!' }
            CleanUp = { param($ctx) if ($ctx.Window) { Close-E2eWindow $ctx.Window } }
        }

        # ---- media: Windows acts on these keys itself (it would play, pause or change the volume), so
        # the key watch sees them and keeps them from Windows ----
        foreach ($c in 'PreviousTrack', 'PlayPause', 'NextTrack', 'VolumeDown', 'VolumeUp') { @{ Command = $c; File = 'media'; Kind = 'Watch' } }

        # ---- windows ----
        (New-E2eOpenerCase 'OpenTaskManager' 'windows' 'ahk_exe taskmgr.exe' -Targets 'taskmgr.exe' -SkipIf {
                if (Test-E2eAdministrator) { return 'Task Manager starts elevated for an administrator, and the test, which is not, could not close it again' }
                if ((Get-E2eForeignWindows 'ahk_exe taskmgr.exe').Count -gt 0) { 'a Task Manager the test did not open is on the desktop' }
            })
        (New-E2eOpenerCase 'OpenControlPanel' 'windows' $script:E2eExplorer -Targets 'explorer.exe')
        (New-E2eOpenerCase 'OpenSettings' 'windows' 'Settings ahk_class ApplicationFrameWindow' -Targets 'ApplicationFrameHost.exe', 'SystemSettings.exe' -SkipIf {
                if ((Get-E2eForeignWindows 'Settings ahk_class ApplicationFrameWindow').Count -gt 0) { 'a Settings window the test did not open is on the desktop; the key would bring it forward' }
            })
        (New-E2eOpenerCase 'OpenServices' 'windows' 'ahk_exe mmc.exe' -Targets 'mmc.exe' -SkipIf {
                if (Test-E2eAdministrator) { return 'mmc.exe asks for the highest rights the user has, so for an administrator Windows would show its elevation prompt' }
                if ((Get-E2eForeignWindows 'ahk_exe mmc.exe').Count -gt 0) { 'a management console the test did not open is on the desktop' }
            })
        (New-E2ePlacementCase 'SnapWindowLeft' { param($h) Test-E2eSnapped $h Left } 'the left half of the screen (Win+Left)')
        (New-E2ePlacementCase 'SnapWindowRight' { param($h) Test-E2eSnapped $h Right } 'the right half of the screen (Win+Right)')
        (New-E2ePlacementCase 'SnapWindowTop' { param($h) Test-E2eSnapped $h Top } 'the top half of the screen (Win+Alt+Up)' -SkipIf {
                if ([Environment]::OSVersion.Version.Build -lt 26100) { 'Windows 11 24H2 brings Win+Alt+Up; this Windows is older' }
            })
        (New-E2ePlacementCase 'SnapWindowBottom' { param($h) Test-E2eSnapped $h Bottom } 'the bottom half of the screen (Win+Alt+Down)' -SkipIf {
                if ([Environment]::OSVersion.Version.Build -lt 26100) { 'Windows 11 24H2 brings Win+Alt+Down; this Windows is older' }
            })
        # Win+Alt+Left and Win+Alt+Right are not in Microsoft's list of Windows shortcuts: what they do
        # depends on the PC (a window manager such as PowerToys), so the keys are checked, not a place.
        @{ Command = 'SnapThirdsLeft'; File = 'windows'; Kind = 'Watch' }
        @{ Command = 'SnapThirdsRight'; File = 'windows'; Kind = 'Watch' }
        (New-E2ePlacementCase 'MoveWindowUp' { param($h) (Get-WindowState $h) -eq 'Maximized' } 'maximized (Win+Up)')
        (New-E2ePlacementCase 'MoveWindowDown' { param($h) (Get-WindowState $h) -eq 'Minimized' } 'minimized (Win+Down)')
        # Win+Home minimizes every other window, a person's too, and on Windows 11 does so only with
        # "Title bar window shake" turned on (it is off by default), so the keys are checked.
        @{ Command = 'FocusWindow'; File = 'windows'; Kind = 'Watch' }
        @{ Command = 'CloseWindow'; File = 'windows' }
        @{ Command = 'CreateDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            SkipIf  = { if ($script:E2eRun.DesktopCount -gt 1) { "the desktop has $($script:E2eRun.DesktopCount) virtual desktops; the desktop cases start from one" } }
            Arrange = { param($ctx) [void](Use-E2eStandin 'A') }
            Assert  = {
                param($ctx)
                (Wait-E2eCondition { (Get-E2eDesktopCount) -eq $ctx.Run.DesktopCount + 1 -and -not [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 4000) | Should -BeTrue -Because 'a new virtual desktop must be made and shown'
                Wait-ScreenChange -Observed
            }
        }
        @{ Command = 'PreviousDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            SkipIf  = { if ((Get-E2eDesktopCount) -ne $script:E2eRun.DesktopCount + 1) { 'CreateDesktop did not leave a second virtual desktop to switch between' } }
            Arrange = { param($ctx) }
            Assert  = {
                param($ctx)
                (Wait-E2eCondition { [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 4000) | Should -BeTrue -Because 'the desktop to the left, where A is, must be shown'
                Wait-ScreenChange -Observed
            }
        }
        @{ Command = 'NextDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            SkipIf  = { if ((Get-E2eDesktopCount) -ne $script:E2eRun.DesktopCount + 1) { 'CreateDesktop did not leave a second virtual desktop to switch between' } }
            Arrange = { param($ctx) }
            Assert  = {
                param($ctx)
                (Wait-E2eCondition { -not [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 4000) | Should -BeTrue -Because 'the desktop to the right, the new one, must be shown'
                Wait-ScreenChange -Observed
            }
        }
        @{ Command = 'CloseDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            SkipIf  = { if ((Get-E2eDesktopCount) -ne $script:E2eRun.DesktopCount + 1) { 'CreateDesktop did not leave a second virtual desktop to close' } }
            Arrange = { param($ctx) }
            Assert  = {
                param($ctx)
                (Wait-E2eCondition { (Get-E2eDesktopCount) -eq $ctx.Run.DesktopCount -and [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 4000) | Should -BeTrue -Because 'the desktop in use must close, back to the one A is on'
                Wait-ScreenChange -Observed
            }
            CleanUp = { param($ctx) Restore-E2eDesktops; [void](Use-E2eStandin 'A') }
        }
        @{ Command = 'ShowDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            Arrange = { param($ctx) Reset-E2eStandinA }
            Assert  = {
                param($ctx)
                $a = $ctx.Run.Standins['A'].Hwnd
                (Wait-E2eCondition { Test-E2eDesktopShown $a } -TimeoutMs 4000) | Should -BeTrue -Because "the desktop must show (in front: $(Get-E2eForegroundText))"
                Wait-ScreenChange
                Invoke-E2eMacroKey $ctx.Case.Slot
                # Which window gets the keyboard back is Windows' choice; the windows must be back.
                (Wait-E2eCondition { -not (Test-E2eDesktopShown $a) } -TimeoutMs 4000) | Should -BeTrue -Because "a second press brings the windows back (in front: $(Get-E2eForegroundText))"
                Wait-ScreenChange -Observed
            }
            CleanUp = {
                param($ctx)
                if (Test-E2eDesktopShown $ctx.Run.Standins['A'].Hwnd) { Wait-ScreenChange; Send-E2eChord 'LWin+d'; [void](Wait-E2eCondition { -not (Test-E2eDesktopShown $ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 3000) }
                Reset-E2eStandinA
            }
        }
        foreach ($c in 'NextScreen', 'PreviousScreen') {
            @{ Command = $c; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
                SkipIf  = { if ([System.Windows.Forms.Screen]::AllScreens.Count -lt 2) { 'needs a second monitor' } }
                Arrange = { param($ctx) Reset-E2eStandinA; $ctx.Screen = [System.Windows.Forms.Screen]::FromHandle($ctx.Run.Standins['A'].Hwnd).DeviceName }
                Assert  = {
                    param($ctx)
                    (Wait-E2eCondition { [System.Windows.Forms.Screen]::FromHandle($ctx.Run.Standins['A'].Hwnd).DeviceName -ne $ctx.Screen } -TimeoutMs 4000) | Should -BeTrue -Because 'the active window must move to another monitor'
                    Wait-ScreenChange -Observed
                }
                CleanUp = { param($ctx) Reset-E2eStandinA }
            }
        }
        @{ Command = 'TaskView'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            Arrange = { param($ctx) Reset-E2eStandinA }
            Assert  = {
                param($ctx)
                $shown = Wait-E2eCondition { $i = Get-WindowInfo ([Macropad.WindowApi]::Foreground()); if ($i.Exe -eq 'explorer.exe' -and $i.Class -ne 'CabinetWClass') { $i } } -TimeoutMs 4000
                $shown | Should -Not -BeNullOrEmpty -Because "Task View must open (in front: $(Get-E2eForegroundText))"
                Wait-ScreenChange -Observed
            }
            CleanUp = { param($ctx) Close-E2eShellOverlay; Reset-E2eStandinA }
        }
        # Print Screen opens the screen capture over the whole screen or copies a screenshot to the
        # clipboard (a setting chooses), Alt+Print Screen replaces the clipboard: the keys are checked.
        @{ Command = 'PrintScreen'; File = 'windows'; Kind = 'Watch' }
        @{ Command = 'PrintActiveWindow'; File = 'windows'; Kind = 'Watch' }
        @{ Command = 'SnippingTool'; File = 'windows'; Kind = 'Custom'; Targets = 'ScreenClippingHost.exe', 'SnippingTool.exe'
            SkipIf  = { if (-not (Test-Path 'Registry::HKEY_CLASSES_ROOT\ms-screenclip')) { 'no app on this Windows opens ms-screenclip: (the Snipping Tool is not installed)' } }
            Arrange = { param($ctx) Reset-E2eStandinA }
            Assert  = {
                param($ctx)
                $shown = Wait-E2eCondition { $i = Get-WindowInfo ([Macropad.WindowApi]::Foreground()); if ($i.Exe -in 'ScreenClippingHost.exe', 'SnippingTool.exe') { $i } } -TimeoutMs 8000
                $shown | Should -Not -BeNullOrEmpty -Because "the screen capture must open (in front: $(Get-E2eForegroundText))"
                Wait-ScreenChange -Observed
            }
            CleanUp = { param($ctx) Close-E2eShellOverlay; Reset-E2eStandinA }
        }
        foreach ($c in 'MoveFocusLeft', 'MoveFocusRight', 'Enter', 'Escape') { @{ Command = $c; File = 'windows' } }

        # ---- custom\chrome ----
        @{ Command = 'EnsureActiveOrOpenChrome'; File = 'custom\chrome'; Kind = 'Custom'
            Arrange = $script:E2eFromB
            Assert  = {
                param($ctx)
                $a = $ctx.Run.Standins['A'].Hwnd
                (Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $a } -TimeoutMs 6000) | Should -BeTrue -Because "Chrome's window comes forward (in front: $(Get-E2eForegroundText))"
                @(Get-E2eLaunches $ctx.Launches).Count | Should -Be 0 -Because 'Chrome is not started again while it has a window'
            }
        }
        @{ Command = 'OpenYoutube'; File = 'custom\chrome'; Kind = 'Custom'; Targets = 'chrome.exe'; Arrange = $script:E2eFromB; Assert = { param($ctx) Assert-E2eChromeUrl $ctx 'https://www.youtube.com/' }; CleanUp = $script:E2eStopLaunched }
        @{ Command = 'OpenGoogle'; File = 'custom\chrome'; Kind = 'Custom'; Targets = 'chrome.exe'; Arrange = $script:E2eFromB; Assert = { param($ctx) Assert-E2eChromeUrl $ctx 'https://www.google.com/' }; CleanUp = $script:E2eStopLaunched }
        foreach ($c in 'ChromePreviousTab', 'ChromeNextTab', 'ChromeDevTools', 'ChromeCloseTab', 'ChromeReopenClosedTab', 'ChromeBookmarkPage', 'ActivateOrCycleChromeAddressBar') { @{ Command = $c; File = 'custom\chrome' } }

        # ---- custom\examples ----
        @{ Command = 'ExampleOpenWebsite'; File = 'custom\examples'; Kind = 'Custom'; Targets = 'chrome.exe'; Arrange = $script:E2eFromB; Assert = { param($ctx) Assert-E2eChromeUrl $ctx 'https://example.com/' }; CleanUp = $script:E2eStopLaunched }
        (New-E2eOpenerCase 'ExampleOpenProgram' 'custom\examples' 'ahk_exe notepad.exe' -Targets 'notepad.exe' -SkipIf {
                if ((Get-E2eForeignWindows 'ahk_exe notepad.exe').Count -gt 0) { 'a Notepad the test did not open is on the desktop; the key would bring it forward' }
            })

        # ---- custom\ssh ----
        @{ Command = 'SshMacroDescription'; File = 'custom\ssh'; Kind = 'Custom'; Macro = @{ name = 'SSH'; description = 'e2e desc test' }; Targets = 'putty.exe'
            Arrange = $script:E2eFromB
            Assert  = { param($ctx) Assert-E2eLaunch $ctx 'putty.exe' '-load "e2e desc test"' -TimeoutMs 16000 }
            CleanUp = $script:E2eStopLaunched
        }
        @{ Command = 'SshExample'; File = 'custom\ssh'; Kind = 'Custom'; Targets = 'ssh.exe'
            Arrange = $script:E2eFromB
            Assert  = { param($ctx) Assert-E2eLaunch $ctx 'ssh.exe' 'user@server.example.com' }
            CleanUp = $script:E2eStopLaunched
        }

        # ---- custom\vscode (no VS Code is used: the stand-in receives the keys) ----
        foreach ($c in 'VsCodeToggleBottomPanel', 'VsCodeToggleSidebar', 'VsCodeCloseEditor', 'VsCodeReopenClosedEditor', 'VsCodeNextEditor', 'VsCodePreviousEditor',
            'VsCodeSearchInFiles', 'VsCodeMovePanelRight', 'VsCodeMovePanelLeft', 'VsCodeOpenSourceControl', 'VsCodeOpenCommandPalette', 'VsCodeDebug',
            'VsCodeAddBreakpoint', 'VsCodeStopDebugging', 'VsCodeStepInto', 'VsCodeStepOut', 'VsCodeStepOver', 'VsCodeGoToDefinition',
            'VsCodePeekDefinition', 'VsCodeGoToReferences', 'VsCodeGoToImplementation') { @{ Command = $c; File = 'custom\vscode' } }
        # Two presses with a pause between: no one-chord twin, so the keys are written here.
        @{ Command = 'VsCodeToggleZenMode'; File = 'custom\vscode'; Chords = @('Ctrl+k', 'z'); Source = $script:E2eDocs.VsCode }
        @{ Command = 'VsCodeNextGroup'; File = 'custom\vscode'; Chords = @('Ctrl+k', 'Ctrl+Right'); Source = $script:E2eDocs.VsCode }
        @{ Command = 'VsCodePreviousGroup'; File = 'custom\vscode'; Chords = @('Ctrl+k', 'Ctrl+Left'); Source = $script:E2eDocs.VsCode }
        @{ Command = 'VsCodeMoveGroupLeft'; File = 'custom\vscode'; Chords = @('Ctrl+k', 'Left'); Source = $script:E2eDocs.VsCode }
        @{ Command = 'VsCodeMoveGroupRight'; File = 'custom\vscode'; Chords = @('Ctrl+k', 'Right'); Source = $script:E2eDocs.VsCode }

        # ---- custom\vsstudio (no Visual Studio is used) ----
        foreach ($c in 'VsStudioShowSolutionExplorer', 'VsStudioSplitPanel', 'VsStudioBuild', 'VsStudioGoToDefinition') { @{ Command = $c; File = 'custom\vsstudio' } }
    )
    $cases = @($cases | ForEach-Object { $_ })
    if ($env:OMB_E2E_CASE -and -not $All) { $cases = @($cases | Where-Object { $(if ($_.Name) { $_.Name } else { $_.Command }) -match $env:OMB_E2E_CASE }) }
    $cases
}

# Commands of the shared files that no case runs, each with what makes it unfit for this test. Both
# languages.
function Get-E2eExclusions {
    @{
        TurnMonitorsOff = 'turns the monitors off'
        Lock            = 'locks the session'
        WinSleep        = 'puts the computer to sleep'
        Hibernate       = 'hibernates the computer'
        Restart         = 'restarts the computer'
        Shutdown        = 'shuts the computer down'
    }
}

# Commands that are in one language's shared command files and not the other's, each with the reason.
# None today: both languages have the same commands.
function Get-E2eOneLanguageCommands {
    @{}
}