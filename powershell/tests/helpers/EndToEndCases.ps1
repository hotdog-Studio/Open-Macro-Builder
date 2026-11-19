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
#   Needs     @{ Why; Met }: the case is conditional. It runs only where Met (a scriptblock) is true,
#             such as a second monitor; the accounting counts its command as conditional, not covered
#   SkipIf    a scriptblock giving a reason when the case would act on a window a person (or an
#             aborted run) left open. On a developer's desktop the case then does not run; under CI
#             the desktop must be clean, so the case fails instead
#   Prior     a scriptblock giving a reason when an earlier case did not leave what this one starts from
#             (CloseDesktop needs the desktop CreateDesktop made); the case then does not run. When the
#             earlier case failed, that failure is what fails the suite
#   Macro     @{ name; description } for the layout entry, when the command reads them
#   Targets   programs whose windows the case expects in front (not a person's interference)
#   Arrange, Assert, CleanUp   scriptblocks given the case's context ($ctx: Case, Lang, Run, Front, ...).
#             The macro key is pressed into the window the case names: $ctx.Front when Arrange sets it,
#             else the last window Arrange made active (Use-E2eStandin, Set-E2eActive); with
#             $ctx.FrontDesktop, the desktop itself. A case that names none presses nothing and fails.
#             A second press inside Assert goes through Invoke-E2eCaseKey, which checks the front first.
#   Covers    the fixes of fix-scripts-1-report.md / fix-scripts-2-report.md it proves, and the parts of
#             them it does not run, with the reason
#
# The stand-ins, open for the whole run: A (40,120) runs as chrome.exe; B (500,120) and C (500,320) run
# as e2eapp.exe; P (40,320) runs as putty.exe. The launcher (ahk\tests\e2e\launcher.cs) is first on the
# macropad's PATH as chrome.exe, putty.exe, ssh.exe and e2eapp.exe: a command that starts one of them
# starts it, and launches.log says with which arguments and from which process. It shows no window, so
# the window a command brings forward is the stand-in of that program. No real Chrome, PuTTY, ssh,
# VS Code or Visual Studio is used.

$script:E2eDocs = @{
    VsCode   = 'https://code.visualstudio.com/docs/reference/default-keybindings'
    VsStudio = 'https://learn.microsoft.com/en-us/visualstudio/ide/default-keyboard-shortcuts-in-visual-studio'
    Chrome   = 'https://support.google.com/chrome/answer/157179'
    Windows  = 'https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec'
}

# The shell path of Control Panel (its class id), which File Explorer shows as Control Panel.
$script:E2eControlPanel = '::{26EE0668-A00A-44D7-9371-BEB064C98683}'

# ---- Pieces the cases share ----

# B is active, A behind it: a command that brings Chrome (A) forward has something to do.
$script:E2eFromB = { param($ctx) [void](Use-E2eStandin 'A'); [void](Use-E2eStandin 'B'); $ctx.Launches = Get-E2eLaunchMark; $ctx.Marks = @(Get-E2eMarks).Count }

# The program a macropad of this language starts others from: AutoHotkey runs them itself, the
# PowerShell macropad through Start-Process (ShellExecute) in its own process.
function Get-E2eMacropadExeName {
    param([string]$Lang)
    if ($Lang -eq 'ahk') { [System.IO.Path]::GetFileName((Get-AhkExe)) } else { 'powershell.exe' }
}

# The command started the program Exe (the launcher in the run's PATH folder) with exactly these
# arguments, from the macropad itself (not through cmd.exe), and Front (when given) is in front.
function Assert-E2eLaunch {
    param($ctx, [string]$Exe, [string]$Arguments, [IntPtr]$Front = [IntPtr]::Zero, [int]$TimeoutMs = 8000, [string]$Folder = (Join-Path $ctx.Run.Dir 'path'))
    $path = Join-Path $Folder $Exe
    $launch = Wait-E2eCondition { Get-E2eLaunches $ctx.Launches | Where-Object { [OmbE2e.ProcessInfo]::LongPath($_.Exe) -eq [OmbE2e.ProcessInfo]::LongPath($path) } | Select-Object -First 1 } -TimeoutMs $TimeoutMs
    $launch | Should -Not -BeNullOrEmpty -Because "the command must start $Exe (the run's stand-in, $path)"
    $launch.Arguments | Should -BeExactly $Arguments
    $launch.Parent | Should -Be (Get-E2eMacropadExeName $ctx.Lang) -Because 'the macropad must start the program itself, not through cmd.exe'
    if ($Front -ne [IntPtr]::Zero) {
        (Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $Front } -TimeoutMs $TimeoutMs) | Should -BeTrue -Because "the program's window must come forward (in front: $(Get-E2eForegroundText))"
    }
}

# The command opened a web address in Chrome: the address whole as the one argument, and Chrome's
# window (A) in front. AutoHotkey puts the address in double quotes, PowerShell's Start-Process not.
function Assert-E2eChromeUrl {
    param($ctx, [string]$Url)
    $quoted = if ($ctx.Lang -eq 'ahk') { '"' + $Url + '"' } else { $Url }
    Assert-E2eLaunch $ctx 'chrome.exe' $quoted -Front $ctx.Run.Standins['A'].Hwnd
}

# Every window that fits the WinTitles, hidden ones too, top of the screen first, with whether it is
# visible and whether Windows cloaks it (keeps it off the screen although it counts as visible): for
# a failure message.
function Get-E2eWindowReport {
    param([string[]]$WinTitle)
    $all = foreach ($t in $WinTitle) { foreach ($h in (Find-E2eWindows $t -IncludeHidden)) { $h } }
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

# A message box of the macropad's with this title came forward and says Text.
function Assert-E2eMessageBox {
    param($ctx, [string]$Title, [string]$Text)
    $winTitle = "$Title ahk_class #32770 ahk_pid $($ctx.Run.Macropad.Process.Id)"
    $ctx.Window = Wait-E2eNewWindow $winTitle -TimeoutMs 5000
    $ctx.Window | Should -Not -BeNullOrEmpty -Because "a message box titled '$Title' must open"
    $active = Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $ctx.Window } -TimeoutMs 3000
    $active | Should -BeTrue -Because "the message box must come forward, where the keyboard is (in front: $(Get-E2eForegroundText))"
    Get-E2eStatusText $ctx.Window $Text | Should -BeExactly $Text -Because "the box must say so (it says: $(Get-E2eFormText $ctx.Window))"
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

# The overlay of Windows' own shell that the case's key brought up over A (Snap Assist, Task View, the
# screen capture), the handle the case saw come up, closed with Escape as a person would: only while
# that very window is in front, never another window of the same program (a person's File Explorer).
function Close-E2eShellOverlay {
    param([IntPtr[]]$Overlay = @())
    foreach ($o in $Overlay) {
        if ($o -eq [IntPtr]::Zero -or [Macropad.WindowApi]::Foreground() -ne $o) { continue }
        Wait-ScreenChange
        Send-E2eChordTo $o 'Escape'
        [void](Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -ne $o } -TimeoutMs 1500)
    }
}
# A window-placement case on A: the key must leave A as Test says, then A goes back.
function New-E2ePlacementCase {
    param([string]$Command, [scriptblock]$Test, [string]$Expect, [hashtable]$Needs, [string]$Covers, [string]$Source)
    @{ Command = $Command; File = 'windows'; Kind = 'Custom'; Needs = $Needs; Covers = $Covers; Expect = $Expect; Test = $Test; Targets = 'explorer.exe'; Source = $Source
        Arrange = { param($ctx) Reset-E2eStandinA }
        Assert  = {
            param($ctx)
            $a = $ctx.Run.Standins['A'].Hwnd
            (Wait-E2eCondition { & $ctx.Case.Test $a } -TimeoutMs 4000) | Should -BeTrue -Because "the active window must be $($ctx.Case.Expect) (now: $((Get-WindowRect $a) | Out-String) state $(Get-WindowState $a))"
            Wait-ScreenChange -Observed
        }
        CleanUp = {
            param($ctx)
            # After a snap, Windows may offer the other half to another window (Snap Assist), a moment
            # later; it is closed so that it does not take the next case's keys.
            if ($ctx.Case.Command -like 'SnapWindow*') {
                $ctx.Overlay = Wait-E2eCondition { $f = [Macropad.WindowApi]::Foreground(); $i = Get-WindowInfo $f; if ($i.Exe -eq 'explorer.exe' -and $i.Class -eq 'XamlExplorerHostIslandWindow') { $f } } -TimeoutMs 1500
            }
            Close-E2eShellOverlay $ctx.Overlay
            Reset-E2eStandinA
        }
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

# The text of the form's control that starts with Prefix (a status line); nothing when no control has
# such a text, so that a wait for it (Wait-E2eCondition) goes on.
function Get-E2eStatusText {
    param([IntPtr]$Form, [string]$Prefix)
    foreach ($c in [Macropad.WindowApi]::Children($Form)) {
        $t = Get-ControlText $c
        if ($t.StartsWith($Prefix)) { return $t }
    }
}

# What a form says: the texts of its controls, for a failure message.
function Get-E2eFormText {
    param([IntPtr]$Form)
    (@([Macropad.WindowApi]::Children($Form) | ForEach-Object { Get-ControlText $_ } | Where-Object { $_ }) -join ' | ')
}

# The one rule for what is the test's among the windows a case's key may have brought. A window is the
# run's because the case saw its own press bring it and recorded it at that moment (Add-E2eRunWindow):
# the case closes those itself. This is for the others: a window that fits, was not there before the
# press (Before) and was never recorded, such as one that came up but never came forward. Windows gives
# no way to tell that the press made it (File Explorer, Settings and Calculator windows belong to
# shared processes). Under -Ci nobody else is at the desktop, so it is the run's: recorded and closed.
# On a developer's desktop it is left open, and said so.
function Close-E2eUnrecordedWindows {
    param([string[]]$WinTitle, [IntPtr[]]$Before = @())
    foreach ($w in (Get-E2eWindows $WinTitle -IncludeCloaked)) {
        if ($Before -contains $w -or $script:E2eRun.Windows -contains $w) { continue }
        if ($env:OMB_E2E_CI -eq '1') { Add-E2eRunWindow $w; Close-E2eWindow $w }
        else { $i = Get-WindowInfo $w; Write-Host "End-to-end: the window $w '$($i.Title)' ($($i.Exe)) came up after the press, and the test cannot tell that the press made it; it is left open (close it yourself)." }
    }
}

# A program a command opened, found by WinTitles: a window of it must come forward (on the screen, not
# cloaked). With -SecondPress, a press made from B must bring the same window forward and, for the next
# 5 seconds, open no other window that fits (cloaked ones count) and start no second Shell process.
# Folder (a scriptblock given the shell path a File Explorer window shows) says which folder is right.
function New-E2eOpenerCase {
    param([string]$Command, [string]$File, [string[]]$WinTitle, [string[]]$Targets, [switch]$SecondPress, [scriptblock]$SkipIf, [hashtable]$Needs,
        [string]$Covers, [int]$TimeoutMs = 10000, [string]$Shell, [scriptblock]$Folder, [string]$FolderWhat)
    $titles = $WinTitle
    $case = @{
        Command = $Command; File = $File; Kind = 'Custom'; Targets = $Targets; Covers = $Covers
        SkipIf  = $SkipIf; Needs = $Needs
        # Before: the windows on the screen (cloaked ones too). A window not in it is one the press made
        # or showed: Windows may keep a hidden frame (Settings') and show that same window.
        Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Before = Get-E2eWindows $ctx.Case.WinTitle -IncludeCloaked; $ctx.Started = Get-Date }
        Assert  = {
            param($ctx)
            $ctx.Window = Wait-E2eNewWindow $ctx.Case.WinTitle -Before $ctx.Before -Active -TimeoutMs $ctx.Case.TimeoutMs
            $ctx.Window | Should -Not -BeNullOrEmpty -Because "a window that fits '$($ctx.Case.WinTitle -join "' or '")' must open and come forward (in front: $(Get-E2eForegroundText); windows that fit: $(Get-E2eWindowReport $ctx.Case.WinTitle))"
            if ($ctx.Case.Folder) {
                $path = Wait-E2eCondition { Get-E2eExplorerFolder $ctx.Window } -TimeoutMs 5000
                (& $ctx.Case.Folder $path) | Should -BeTrue -Because "the window must show $($ctx.Case.FolderWhat) (it shows '$path')"
            }
            if ($ctx.Case.SecondPress) {
                # The command may still be running after its window came forward (Settings' start
                # returns late, and the command then brings that window forward itself): the window
                # must stay in front for 1.5 s before the second press.
                $held = [System.Diagnostics.Stopwatch]::new()
                $steady = Wait-E2eCondition { if ([Macropad.WindowApi]::Foreground() -eq $ctx.Window) { if (-not $held.IsRunning) { $held.Start() }; $held.ElapsedMilliseconds -ge 1500 } else { $held.Reset(); $false } } -TimeoutMs 8000
                $steady | Should -BeTrue -Because "the window must stay in front after the first press (in front: $(Get-E2eForegroundText))"
                $b = Use-E2eStandin 'B'
                Invoke-E2eCaseKey $ctx -Front $b.Hwnd
                $again = Wait-E2eCondition { if ([Macropad.WindowApi]::Foreground() -eq $ctx.Window) { $true } } -TimeoutMs 6000
                $again | Should -BeTrue -Because "a second press must bring the same window forward (in front: $(Get-E2eForegroundText); windows that fit, hidden ones too: $(Get-E2eWindowReport $ctx.Case.WinTitle))"
                # A wrongly reopening command shows its window within the 5 seconds a helper gives a
                # program; watch that long, and fail as soon as one appears. PseudoConsoleWindow is the
                # helper window Windows makes for a shell that Windows Terminal shows (ConPTY); it
                # belongs to the first press's shell.
                $parents = { @($ctx.Run.Macropad.Process.Id) + @(Get-Process WindowsTerminal, OpenConsole -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) }
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                while ($sw.ElapsedMilliseconds -lt 5000) {
                    $new = @(foreach ($w in (Get-E2eWindows $ctx.Case.WinTitle -IncludeCloaked)) { if ($ctx.Before -notcontains $w -and $w -ne $ctx.Window -and [Macropad.WindowApi]::ClassName($w) -ne 'PseudoConsoleWindow') { $w } })
                    $new.Count | Should -Be 0 -Because "a second press must not open another window (new: $(($new | ForEach-Object { $i = Get-WindowInfo $_; "'$($i.Title)' $($i.Exe) $($i.Class) cloaked=$([OmbE2e.Dwm]::Cloaked($_))" }) -join ', '))"
                    if ($ctx.Case.Shell) {
                        $p = & $parents
                        $shells = @(Get-CimInstance Win32_Process -Filter "Name = '$($ctx.Case.Shell)'" | Where-Object { $_.CreationDate -gt $ctx.Started -and $_.ProcessId -ne $ctx.Run.Macropad.Process.Id -and $p -contains [int]$_.ParentProcessId })
                        $shells.Count | Should -BeLessOrEqual 1 -Because "two presses must start one $($ctx.Case.Shell) (a second Terminal tab would be a second one)"
                    }
                    Wait-Pump 250
                }
            }
        }
        CleanUp = {
            param($ctx)
            if ($ctx.Window) { Close-E2eWindow $ctx.Window }
            elseif ($ctx.Pressed) { Close-E2eUnrecordedWindows $ctx.Case.WinTitle $ctx.Before }
        }
    }
    $case.WinTitle = $titles
    $case.SecondPress = [bool]$SecondPress
    $case.Shell = $Shell
    $case.TimeoutMs = $TimeoutMs
    $case.Folder = $Folder
    $case.FolderWhat = $FolderWhat
    $case
}

$script:E2eExplorer = 'ahk_class CabinetWClass'

# What a conditional case needs.
$script:E2eNeedsStandardUser = { -not (Test-E2eAdministrator) }

# Settings and Calculator are Store apps: their windows are found by the app's application id (as
# Get-StartApps lists it), whatever the display language, never by a title. Then what a Calculator case
# needs, and when it would act on a Calculator a person left open.
$script:E2eSettings = 'app:windows.immersivecontrolpanel_cw5n1h2txyewy!microsoft.windows.immersivecontrolpanel'
$script:E2eCalculator = 'app:Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'
$script:E2eNeedsCalculator = @{ Why = 'needs the Calculator app, which a Windows may not have'; Met = { [bool](Get-AppxPackage Microsoft.WindowsCalculator -ErrorAction SilentlyContinue) } }
$script:E2eCalculatorSkipIf = {
    $f = Get-E2eForeignWindows $script:E2eCalculator
    if ($f.Count -gt 0) { "a Calculator the test did not open is on the desktop; the key would bring it forward" }
}

# The Calculator windows that were not there before (Before), cloaked ones too: while Calculator
# starts, Windows keeps its frame cloaked for about 250 ms.
function Get-E2eCalculatorWindows {
    param([IntPtr[]]$Before = @())
    , @(foreach ($w in (Get-E2eWindows $script:E2eCalculator -IncludeCloaked)) { if ($Before -notcontains $w) { $w } })
}

# Waits until one new Calculator window is shown and active, then watches WatchMs more: no second one may
# appear. '' when so, else what was wrong. The window that came forward is the one the case's own press
# brought: it is recorded the moment it is seen, so that the run closes it. A second window is not
# recorded (Windows gives no way to tie a Calculator frame, a window of ApplicationFrameHost, to the
# process a press started): Close-E2eUnrecordedWindows decides about it. $script:E2eShownAfterMs: how
# long after the last paced change, the press, the window showed.
function Test-E2eOneCalculator {
    param([IntPtr[]]$Before, [int]$WatchMs = 3000)
    $shown = Wait-E2eCondition {
        $f = [Macropad.WindowApi]::Foreground()
        if ((Get-E2eCalculatorWindows $Before) -contains $f -and -not [OmbE2e.Dwm]::Cloaked($f)) { $f }
    } -TimeoutMs 10000 -EveryMs 10
    if (-not $shown) { return "no Calculator window was shown and active within 10 s (in front: $(Get-E2eForegroundText); windows that fit: $(Get-E2eWindowReport $script:E2eCalculator))" }
    $script:E2eShownAfterMs = $script:E2eChangeClock.ElapsedMilliseconds
    Wait-ScreenChange -Observed
    Add-E2eRunWindow $shown
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $WatchMs) {
        $all = Get-E2eCalculatorWindows $Before
        if ($all.Count -gt 1) { return "$($all.Count) Calculator windows: $(Get-E2eWindowReport $script:E2eCalculator)" }
        Wait-Pump 100
    }
    ''
}

# Closes the Calculator windows the case's presses brought, paced: the ones the case recorded as it saw
# them. A hidden one is among them: a window the case closed by its close button may stay, hidden, for
# a while, and is closed again here should it have come back (Close-E2eWindow says when a window is
# gone, and throws otherwise). Calculator's own process ends by itself when its window closes, so every
# start of a series is a cold one, as a person's first press is.
function Close-E2eCalculators {
    param([IntPtr[]]$Before)
    $all = Get-E2eWindows $script:E2eCalculator -IncludeCloaked -IncludeHidden
    foreach ($w in @($script:E2eRun.Windows)) { if ($all -contains $w) { Close-E2eWindow $w } }
    Close-E2eUnrecordedWindows $script:E2eCalculator $Before
}

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
                [void](Wait-E2eCondition { -not ($want.Keys | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ctx.Dir $_)) }) } -TimeoutMs 10000)
                foreach ($f in $want.Keys) {
                    $path = Join-Path $ctx.Dir $f
                    (Test-Path -LiteralPath $path) | Should -BeTrue -Because "$f must be written by its script"
                    ([System.IO.File]::ReadAllText($path)).Trim() | Should -BeExactly $want[$f] -Because "of what $f says the script was given"
                }
                [void](Use-E2eStandin 'B')
            }
        }
        @{ Command = 'E2eAmpersand'; File = 'e2e'; Kind = 'Custom'; Covers = 'AHK-2 (fix 1: item 3a)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.File = Join-Path $ctx.Run.Dir 'E2E Test\amp.txt'; Remove-Item -LiteralPath $ctx.File -ErrorAction SilentlyContinue; $ctx.Marks = @(Get-E2eMarks).Count }
            Assert  = {
                param($ctx)
                # Through cmd.exe, the & would end the command and the file would hold nothing or 'a'.
                $text = Wait-E2eCondition { if (Test-Path -LiteralPath $ctx.File) { [System.IO.File]::ReadAllText($ctx.File) } } -TimeoutMs 8000
                $text | Should -BeExactly 'a&b'
                [void](Wait-E2eMark $ctx.Marks 'ampersand done' -TimeoutMs 10000)
            }
        }
        @{ Command = 'E2eOpenSpaces'; File = 'e2e'; Kind = 'Custom'; Covers = 'AHK-2 (fix 1: item 4: the command line; that the window of a started program then comes forward is proven by the opener cases, OpenCalculator, OpenFileExplorer and the others)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Launches = Get-E2eLaunchMark; $ctx.Marks = @(Get-E2eMarks).Count }
            Assert  = {
                param($ctx)
                $dir = Join-Path $ctx.Run.Dir 'E2E Test'
                Assert-E2eLaunch $ctx 'e2e app.exe' ('"{0}"' -f (Join-Path $dir 'note a.txt')) -Folder $dir
                [void](Wait-E2eMark $ctx.Marks 'spaces done' -TimeoutMs 10000)
            }
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
                Invoke-E2eCaseKey $ctx -Front $b
                (Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $c } -TimeoutMs 6000) | Should -BeTrue -Because "a press while one of its windows is active brings the bottom one (in front: $(Get-E2eForegroundText))"
            }
        }
        (New-E2eOpenerCase 'OpenFileExplorer' 'windows' $script:E2eExplorer -Targets 'explorer.exe' -Covers 'AHK-8 (fix 1: item 11)' `
                -Folder { param($p) $p -and -not $p.StartsWith($script:E2eControlPanel) } -FolderWhat 'where File Explorer starts (not Control Panel)' -SkipIf {
                $f = Get-E2eForeignWindows $script:E2eExplorer
                if ($f.Count -gt 0) { "File Explorer windows the test did not open are on the desktop ($($f -join ', ')); the key would bring one of them forward" }
            })
        @{ Command = 'ExampleOpenFolder'; File = 'custom\examples'; Kind = 'Custom'; Targets = 'explorer.exe'; Covers = 'AHK-17, PS-3 and the twin fix (fix 1: item 15)'
            Arrange = {
                param($ctx)
                # Another File Explorer window is active first: the new one must still come forward.
                $ctx.Before = Get-E2eWindows $script:E2eExplorer -IncludeCloaked
                [void](Use-E2eStandin 'B')
                Wait-ScreenChange
                Start-Process explorer.exe -ArgumentList ('"{0}"' -f (Join-Path $ctx.Run.Dir 'E2E Test'))
                $ctx.Other = Wait-E2eNewWindow $script:E2eExplorer -Before $ctx.Before -TimeoutMs 8000
                if (-not $ctx.Other) { throw 'The test could not open the first File Explorer window.' }
                [void](Set-E2eActive $ctx.Other)
                $ctx.Before = Get-E2eWindows $script:E2eExplorer -IncludeCloaked
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
        # Calculator cloaks its window for about 250 ms while it starts (seen in 22 of 22 starts); the
        # window counts once Windows shows it, and the second press must find that same window.
        (New-E2eOpenerCase 'OpenCalculator' 'custom\examples' $script:E2eCalculator -Targets 'ApplicationFrameHost.exe', 'CalculatorApp.exe' -SecondPress -Covers 'AHK-16, PS-1 (fix 1: item 14)' `
                -Needs $script:E2eNeedsCalculator -SkipIf $script:E2eCalculatorSkipIf)
        # The Calculator series, each made Get-E2eRepeat times (run.ps1 -Repeat; 2 by default) and
        # counted per language. First, the second press comes while the first Calculator is still
        # starting: there must be exactly one window, shown and active. The moment is a state, not a
        # time: the first window exists and Windows still keeps it off the screen (cloaked), however
        # long this machine takes to get there (about 0.2 s on a fast PC, 2 to 3 s on the CI machine).
        # The press is paced, then waits for that state and follows it at once. Only a try that reached
        # it counts, and a try that missed it is made again, up to three times as many tries as wanted.
        # Where the state never lasts long enough for a press, that is a condition of the machine, which
        # the case measures as it runs: it then says so and counts as not run, not as failed.
        @{ Command = 'OpenCalculator'; Name = 'OpenCalculator (second press while it starts)'; File = 'custom\examples'; Kind = 'Custom'; Targets = 'ApplicationFrameHost.exe', 'CalculatorApp.exe'
            Needs = @{ Why = 'needs the Calculator app, and a machine on which its first window is still cloaked when the second press comes (measured as the case runs)'; Met = $script:E2eNeedsCalculator.Met }
            SkipIf = $script:E2eCalculatorSkipIf; Covers = 'a second press while Calculator is still starting finds that window and opens no other'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Before = Get-E2eWindows $script:E2eCalculator -IncludeCloaked }
            Assert  = {
                param($ctx)
                $b = $ctx.Run.Standins['B'].Hwnd
                $n = Get-E2eRepeat; $hit = 0; $tries = 0
                $failed = [System.Collections.Generic.List[string]]::new()
                $moments = [System.Collections.Generic.List[string]]::new()
                while ($hit -lt $n -and $tries -lt 3 * $n) {
                    $tries++
                    if ($tries -gt 1) { [void](Use-E2eStandin 'B'); Invoke-E2eCaseKey $ctx -Front $b }
                    $sincePress = [System.Diagnostics.Stopwatch]::StartNew()
                    Wait-ScreenChange
                    $first = Wait-E2eCondition { $w = Get-E2eCalculatorWindows $ctx.Before; if ($w.Count -gt 0) { $w[0] } } -TimeoutMs 15000 -EveryMs 5
                    if (-not $first) { $failed.Add("try ${tries}: no Calculator window appeared within 15 s of the press (in front: $(Get-E2eForegroundText); windows that fit: $(Get-E2eWindowReport $script:E2eCalculator))"); continue }
                    $seen = $sincePress.ElapsedMilliseconds
                    # Into a window the case names only: B, or that Calculator window, which Windows
                    # makes active while it is still cloaked.
                    $fg = [Macropad.WindowApi]::Foreground()
                    if (-not [OmbE2e.Dwm]::Cloaked($first)) { $moments.Add("$seen ms, already shown when first seen") }
                    elseif ($fg -ne $b -and $fg -ne $first) { $moments.Add("$seen ms, cloaked, but $(Get-E2eForegroundText) was in front") }
                    else {
                        $ctx.Pressed = $true
                        Invoke-E2eMacroKey $ctx.Case.Slot
                        if ([OmbE2e.Dwm]::Cloaked($first)) { $hit++; $moments.Add("$seen ms, pressed while cloaked") } else { $moments.Add("$seen ms, shown while the key went down") }
                    }
                    Add-E2eRunWindow $first
                    $why = Test-E2eOneCalculator $ctx.Before
                    if ($why) { $failed.Add("try ${tries}: $why") }
                    Close-E2eCalculators $ctx.Before
                }
                $told = "{0} reached in {1} tries, {2} failed. First window seen after the first press: {3}" -f $hit, $tries, $failed.Count, ($moments -join '; ')
                Write-Host "End-to-end Calculator series, $($ctx.Lang), second press while it starts: $told"
                ($failed -join '; ') | Should -BeNullOrEmpty -Because 'every try must end with exactly one Calculator window, shown and active'
                if ($hit -eq 0) { $ctx.NotRun = "conditional: on this machine the first Calculator window was never still cloaked when the second press could come ($told)" }
            }
            CleanUp = { param($ctx) if ($null -ne $ctx.Before) { Close-E2eCalculators $ctx.Before } }
        }
        # Then Calculator is closed and the key pressed again as soon as the pacing allows: a new window
        # must come, shown and active. By then the closed window is gone (it still existed at none of
        # 24 paced presses, 12 per language, when this was written), so the moment at which a press
        # could find the closing window is not one this test may reach: that takes a press sooner
        # after the close than three changes of the screen a second allow.
        @{ Command = 'OpenCalculator'; Name = 'OpenCalculator (closed and opened again)'; File = 'custom\examples'; Kind = 'Custom'; Targets = 'ApplicationFrameHost.exe', 'CalculatorApp.exe'
            Needs = $script:E2eNeedsCalculator; SkipIf = $script:E2eCalculatorSkipIf; Covers = 'a press after Calculator was closed opens a new one, every time'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Before = Get-E2eWindows $script:E2eCalculator -IncludeCloaked }
            Assert  = {
                param($ctx)
                $b = $ctx.Run.Standins['B'].Hwnd
                $n = Get-E2eRepeat; $existed = 0
                $failed = [System.Collections.Generic.List[string]]::new()
                $times = [System.Collections.Generic.List[string]]::new()
                $why = Test-E2eOneCalculator $ctx.Before
                if ($why) { throw "The first press: $why" }
                foreach ($try in 1..$n) {
                    $old = [Macropad.WindowApi]::Foreground()
                    if ((Get-E2eCalculatorWindows $ctx.Before) -notcontains $old) { throw "Try ${try}: the Calculator window was not in front before the close; $(Get-E2eForegroundText) was." }
                    Wait-ScreenChange
                    [void][Macropad.WindowApi]::Post($old, 0x10, [IntPtr]::Zero, [IntPtr]::Zero)  # WM_CLOSE, as its close button
                    # Windows gives the keyboard back to the window before it, B. The key goes into B
                    # only, paced as every press is.
                    if (-not (Wait-E2eCondition { [Macropad.WindowApi]::Foreground() -eq $b } -TimeoutMs 1500 -EveryMs 5) -and $env:OMB_E2E_CI -eq '1') { [void](Use-E2eStandin 'B') }
                    Invoke-E2eCaseKey $ctx -Front $b
                    if ([Macropad.WindowApi]::Exists($old)) { $existed++ }
                    $why = Test-E2eOneCalculator $ctx.Before
                    if ($why) { $failed.Add("try ${try}: $why"); break }
                    $times.Add("$($script:E2eShownAfterMs) ms")
                }
                Write-Host ("End-to-end Calculator series, {0}, closed and opened again: {1} presses, {2} with the closed window still there, {3} failed. New window shown after the press: {4}" -f $ctx.Lang, $times.Count, $existed, $failed.Count, ($times -join '; '))
                ($failed -join '; ') | Should -BeNullOrEmpty -Because 'every press after a close must bring one new Calculator window, shown and active'
            }
            CleanUp = { param($ctx) if ($null -ne $ctx.Before) { Close-E2eCalculators $ctx.Before } }
        }
        @{ Command = 'E2eOpenFolderComma'; File = 'e2e'; Kind = 'Custom'; Only = 'ps'; Why = 'Open-ExplorerWindow is a PowerShell helper; the AutoHotkey version has none'; Targets = 'explorer.exe'; Covers = 'PS-9 (fix 1: item 16)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B'); $ctx.Before = Get-E2eWindows $script:E2eExplorer -IncludeCloaked }
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
        @{ Name = 'ChromeNewTab (Chrome shows no window)'; Command = 'ChromeNewTab'; File = 'custom\chrome'; Kind = 'Custom'; Covers = 'AHK-13, PS-8, N2 (fix 2: items 4, 5: one of the eight guarded commands, since all eight call the same guard, EnsureActiveOrOpenChrome)'
            SkipIf  = {
                $f = Get-E2eForeignWindows 'ahk_exe chrome.exe'
                if ($f.Count -gt 0) { "a Chrome the test did not start has windows open; for this case Chrome must have none" }
            }
            Arrange = {
                param($ctx)
                $ctx.A = $ctx.Run.Standins['A']
                Wait-ScreenChange
                Set-WindowState $ctx.A.Hwnd Hide
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
            CleanUp = { param($ctx) Wait-ScreenChange; Set-WindowState $ctx.Run.Standins['A'].Hwnd Show }
        }
        foreach ($c in 'ChromeNewTab', 'ChromeOpenNewWindow', 'ChromeOpenIncognitoWindow', 'ChromeOpenDownloads', 'ChromeOpenHistory', 'ChromeOpenBookmarks') {
            @{ Command = $c; File = 'custom\chrome'; From = 'B'; Covers = 'PS-8, N2 (fix 2: item 6)' }
        }
        @{ Command = 'ChromeOpenExtensions'; File = 'custom\chrome'; From = 'B'; Chords = @('Ctrl+l', 'text:chrome://extensions', 'Enter'); Source = $script:E2eDocs.Chrome; Covers = 'PS-10 (fix 2: item 7)' }
        @{ Command = 'ChromeOpenSettings'; File = 'custom\chrome'; From = 'B'; Chords = @('Ctrl+l', 'text:chrome://settings', 'Enter'); Source = $script:E2eDocs.Chrome; Covers = 'PS-10 (fix 2: item 7)' }
        @{ Command = 'SshMacroName'; File = 'custom\ssh'; Kind = 'Custom'; Macro = @{ name = 'e2e test' }; Targets = 'putty.exe'
            Covers  = 'AHK-15, AHK-13 (fix 2: item 9. Not run: "PuTTY not installed", which shows an AutoHotkey error dialog by design, and "PuTTY never shows a window", the same WinWait path as E2eNeverAppears)'
            Arrange = $script:E2eFromB
            Assert  = { param($ctx) Assert-E2eLaunch $ctx 'putty.exe' '-load "e2e test"' -Front $ctx.Run.Standins['P'].Hwnd -TimeoutMs 16000 }
        }
        foreach ($c in 'VsCodeRestartDebugging', 'VsCodePauseDebugging', 'VsCodePeekImplementations', 'VsCodeAddInlineBreakpoint', 'VsCodeSplitPanel', 'VsCodeOpenTerminal') {
            @{ Command = $c; File = 'custom\vscode'; Covers = 'AHK-22 to AHK-26 (fix 2: item 10: the keys; no VS Code is used)' }
        }
        @{ Command = 'VsStudioShowTestExplorer'; File = 'custom\vsstudio'; Covers = 'AHK-28, PS-7 (fix 2: item 12: the keys; no Visual Studio is used)' }
        @{ Command = 'ShowDelayedKeyForm'; File = 'custom\automation'; Kind = 'Custom'
            Covers  = 'AHK-19 (fix 2: item 14. Not run: the 11-digit delay, since proving that nothing is sent takes 10 s of waiting in each language)'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B') }
            Assert  = {
                param($ctx)
                $ctx.Form = Wait-E2eForm 'Send key after delay'
                $edits = Get-E2eEdits $ctx.Form
                $key = if ($ctx.Lang -eq 'ahk') { '{F7}' } else { 'F7' }
                Set-ControlText $edits[0] $key
                Set-ControlText $edits[1] '0'
                [OmbE2e.KeyWatch]::Clear()
                # The scheduled F7 is seen by the key watch and kept from whatever window is in front.
                [OmbE2e.KeyWatch]::Swallow = $true
                Wait-ScreenChange
                Invoke-E2eButton $ctx.Form 'Schedule'
                # A delay of 0 sends at once (it used to cancel the timer).
                $taps = Wait-E2eTaps { Get-E2eWatchTaps } 1 -TimeoutMs 1500 -SettleMs 300
                ($taps -join ', ') | Should -Be 'F7'
                [Macropad.WindowApi]::Visible($ctx.Form) | Should -BeFalse -Because 'Schedule hides the form'
            }
            CleanUp = { param($ctx) [void](Use-E2eStandin 'B') }
        }
        @{ Name = 'ShowDelayedKeyForm (records a key, lets go of the keyboard when closed)'; Command = 'ShowDelayedKeyForm'; File = 'custom\automation'; Kind = 'Custom'
            Covers  = 'AHK-18 in part, AHK-20 (fix 2: items 13, 15), PS-11. Ctrl+Shift+T is recorded in PowerShell only: the AutoHotkey form reads whether Ctrl, Shift and Alt are physically held, which keys sent by a program never are, so it records F7 alone. Not run: "click Record twice", whose wait the closing part covers'
            Arrange = { param($ctx) [void](Use-E2eStandin 'B') }
            Assert  = {
                param($ctx)
                $ctx.Form = Wait-E2eForm 'Send key after delay'
                $edits = Get-E2eEdits $ctx.Form
                Invoke-E2eButton $ctx.Form 'Record key'
                (Wait-E2eCondition { Get-E2eStatusText $ctx.Form 'Press a key' } -TimeoutMs 3000) | Should -Not -BeNullOrEmpty -Because "Record key must ask for a key within 3 s (the form says: $(Get-E2eFormText $ctx.Form))"
                if ($ctx.Lang -eq 'ahk') { $chord = 'F7'; $want = '{F7}' } else { $chord = 'Ctrl+Shift+t'; $want = 'Ctrl+Shift+t' }
                Send-E2eChordTo $ctx.Form $chord
                $got = Wait-E2eCondition { $t = Get-ControlText $edits[0]; if ($t -eq $want) { $t } } -TimeoutMs 3000
                Wait-Pump 300
                $got | Should -Be $want
                Get-ControlText $edits[0] | Should -Be $want -Because 'nothing more may be recorded after the key'
                (Get-E2eStatusText $ctx.Form 'Recorded') | Should -Be "Recorded $want." -Because "the form says what it recorded (it says: $(Get-E2eFormText $ctx.Form))"
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
                Send-E2eChordTo $b.Hwnd 'a'
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
                (Wait-E2eCondition { Get-E2eStatusText $ctx.Form 'Click a mouse button' } -TimeoutMs 3000) | Should -Not -BeNullOrEmpty -Because "Record click must ask for a click within 3 s (the form says: $(Get-E2eFormText $ctx.Form))"
                $b = $ctx.Run.Standins['B']
                $r = Get-WindowRect $b.Hwnd
                $x = $r.X + 200; $y = $r.Y + 110
                # The button is held until the form says that it has the click: both forms look for a
                # held button every 10 ms, and on a slow machine a press of a fixed length can fall
                # between two looks (a person holds a button far longer than the test's 30 ms).
                Send-E2eClick $x $y -Until { Get-E2eStatusText $ctx.Form 'Captured' }
                Get-E2eStatusText $ctx.Form 'Captured' | Should -Be "Captured Left click at $x, $y." -Because "the form records a click held at the pointer (the form says: $(Get-E2eFormText $ctx.Form); in front: $(Get-E2eForegroundText); the pointer is at $([OmbE2e.Input]::MousePosition() -join ', '))"
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
        (New-E2eOpenerCase 'OpenTaskManager' 'windows' 'ahk_exe taskmgr.exe' -Targets 'taskmgr.exe' `
                -Needs @{ Why = 'needs a standard user: for an administrator Task Manager starts elevated, and the test, which is not, could not close it'; Met = $script:E2eNeedsStandardUser } -SkipIf {
                if ((Get-E2eForeignWindows 'ahk_exe taskmgr.exe').Count -gt 0) { 'a Task Manager the test did not open is on the desktop' }
            })
        (New-E2eOpenerCase 'OpenControlPanel' 'windows' $script:E2eExplorer -Targets 'explorer.exe' -Folder { param($p) $p -and $p.StartsWith($script:E2eControlPanel) } -FolderWhat 'Control Panel')
        # The first press is a cold start: no Settings window, hidden ones included, is there (SkipIf),
        # and Settings ends when its window closes. The second, with Settings running behind B, a warm one.
        (New-E2eOpenerCase 'OpenSettings' 'windows' $script:E2eSettings -Targets 'ApplicationFrameHost.exe', 'SystemSettings.exe' -SecondPress -Covers 'Settings comes forward on a cold start and on a warm one' -SkipIf {
                if ((Get-E2eForeignWindows $script:E2eSettings -IncludeHidden).Count -gt 0) { 'a Settings window the test did not open is on the desktop; the key would bring it forward' }
            })
        (New-E2eOpenerCase 'OpenServices' 'windows' 'ahk_exe mmc.exe' -Targets 'mmc.exe' `
                -Needs @{ Why = 'needs a standard user: mmc.exe asks for the highest rights the user has, so for an administrator Windows shows its elevation prompt'; Met = $script:E2eNeedsStandardUser } -SkipIf {
                if ((Get-E2eForeignWindows 'ahk_exe mmc.exe').Count -gt 0) { 'a management console the test did not open is on the desktop' }
            })
        (New-E2ePlacementCase 'SnapWindowLeft' { param($h) Test-E2eSnapped $h Left } 'the left half of the screen (Win+Left)')
        (New-E2ePlacementCase 'SnapWindowRight' { param($h) Test-E2eSnapped $h Right } 'the right half of the screen (Win+Right)')
        # Microsoft's list of Windows 11 shortcuts gives Win+Alt+Up and Win+Alt+Down (snap to the top or
        # bottom half) with no version note; its Windows 10 list has neither.
        (New-E2ePlacementCase 'SnapWindowTop' { param($h) Test-E2eSnapped $h Top } 'the top half of the screen (Win+Alt+Up)' -Source $script:E2eDocs.Windows)
        (New-E2ePlacementCase 'SnapWindowBottom' { param($h) Test-E2eSnapped $h Bottom } 'the bottom half of the screen (Win+Alt+Down)' -Source $script:E2eDocs.Windows)
        # Win+Alt+Left and Win+Alt+Right are not in Microsoft's list of Windows shortcuts: what they do
        # depends on the PC (a window manager such as PowerToys), so the keys are checked, not a place.
        @{ Command = 'SnapThirdsLeft'; File = 'windows'; Kind = 'Watch' }
        @{ Command = 'SnapThirdsRight'; File = 'windows'; Kind = 'Watch' }
        (New-E2ePlacementCase 'MoveWindowUp' { param($h) (Get-WindowState $h) -eq 'Maximized' } 'maximized (Win+Up)')
        (New-E2ePlacementCase 'MoveWindowDown' { param($h) (Get-WindowState $h) -eq 'Minimized' } 'minimized (Win+Down)')
        # Win+Home minimizes every other window, a person's too, and on Windows 11 does so only with
        # "Title bar window shake" turned on (it is off by default), so the keys are checked.
        @{ Command = 'FocusWindow'; File = 'windows'; Kind = 'Watch' }
        # The stand-in answers Alt+F4 itself, so nothing closes; had the keys gone to the desktop, Windows
        # would have opened its Shut Down dialog.
        @{ Command = 'CloseWindow'; File = 'windows'; Kind = 'Custom'
            Arrange = { param($ctx) & $script:E2eChordArrange $ctx; $ctx.Dialogs = Get-E2eWindows 'ahk_class #32770 ahk_exe explorer.exe' -IncludeCloaked }
            Assert  = {
                param($ctx)
                & $script:E2eChordAssert $ctx
                $new = @(foreach ($w in (Get-E2eWindows 'ahk_class #32770 ahk_exe explorer.exe' -IncludeCloaked)) { if ($ctx.Dialogs -notcontains $w) { $w } })
                $new.Count | Should -Be 0 -Because 'Alt+F4 must not reach the desktop (Shut Down Windows)'
            }
            CleanUp = {
                param($ctx)
                # Should the Shut Down dialog have opened, it is closed by a message to that dialog
                # (WM_CLOSE, as its Cancel), never by a key.
                foreach ($w in (Get-E2eWindows 'ahk_class #32770 ahk_exe explorer.exe' -IncludeCloaked)) {
                    if ($ctx.Dialogs -notcontains $w) { Wait-ScreenChange; [void][Macropad.WindowApi]::Post($w, 0x10, [IntPtr]::Zero, [IntPtr]::Zero) }
                }
            }
        }
        @{ Command = 'CreateDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            SkipIf  = { if ($script:E2eRun.DesktopCount -gt 1) { "the desktop has $($script:E2eRun.DesktopCount) virtual desktops; the desktop cases start from one" } }
            Arrange = { param($ctx) [void](Use-E2eStandin 'A'); $ctx.DesktopsBefore = Get-E2eDesktops; $ctx.CurrentBefore = Get-E2eCurrentDesktop }
            Assert  = {
                param($ctx)
                # The desktop the key made is the new one Windows switches to: recorded the moment it is
                # seen, so that an abort during the wait still leaves it to the clean-up.
                $made = Wait-E2eCondition {
                    $now = Get-E2eCurrentDesktop
                    if ($now -and $now -ne $ctx.CurrentBefore -and $ctx.DesktopsBefore -notcontains $now) { Add-E2eNewDesktop $now; $true }
                } -TimeoutMs 4000
                $made | Should -BeTrue -Because 'a new virtual desktop must be made and shown'
                (Get-E2eDesktopCount) | Should -Be ($ctx.Run.DesktopCount + 1) -Because 'the key makes one desktop'
                [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) | Should -BeFalse -Because 'the new desktop is shown'
                Wait-ScreenChange -Observed
            }
        }
        @{ Command = 'PreviousDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            Prior   = { if (@($script:E2eRun.NewDesktops).Count -ne 1) { 'no virtual desktop made by CreateDesktop in this run (it failed, was skipped or did not run)' } }
            # CreateDesktop left the new, empty desktop shown: the desktop itself has the keyboard.
            Arrange = { param($ctx) $ctx.FrontDesktop = $true }
            Assert  = {
                param($ctx)
                (Wait-E2eCondition { [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 4000) | Should -BeTrue -Because 'the desktop to the left, where A is, must be shown'
                Wait-ScreenChange -Observed
            }
        }
        @{ Command = 'NextDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            Prior   = { if (@($script:E2eRun.NewDesktops).Count -ne 1) { 'no virtual desktop made by CreateDesktop in this run (it failed, was skipped or did not run)' } }
            # Back on A's desktop, A is the window the key goes into.
            Arrange = { param($ctx) [void](Use-E2eStandin 'A') }
            Assert  = {
                param($ctx)
                (Wait-E2eCondition { -not [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 4000) | Should -BeTrue -Because 'the desktop to the right, the new one, must be shown'
                Wait-ScreenChange -Observed
            }
        }
        @{ Command = 'CloseDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            Prior   = { if (@($script:E2eRun.NewDesktops).Count -ne 1) { 'no virtual desktop made by CreateDesktop in this run (it failed, was skipped or did not run)' } }
            # NextDesktop left the new, empty desktop shown.
            Arrange = { param($ctx) $ctx.FrontDesktop = $true }
            Assert  = {
                param($ctx)
                (Wait-E2eCondition { (Get-E2eDesktopCount) -eq $ctx.Run.DesktopCount -and [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 4000) | Should -BeTrue -Because 'the desktop in use must close, back to the one A is on'
                Wait-ScreenChange -Observed
            }
            CleanUp = {
                param($ctx)
                Close-E2eNewDesktops
                # The switch back settles before A is made active.
                [void](Wait-E2eCondition { [OmbE2e.Desktops]::OnCurrent($ctx.Run.Standins['A'].Hwnd) } -TimeoutMs 3000)
                Wait-ScreenChange -Observed
                [void](Use-E2eStandin 'A')
            }
        }
        @{ Command = 'ShowDesktop'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            Arrange = { param($ctx) Reset-E2eStandinA }
            Assert  = {
                param($ctx)
                $a = $ctx.Run.Standins['A'].Hwnd
                (Wait-E2eCondition { Test-E2eDesktopShown $a } -TimeoutMs 4000) | Should -BeTrue -Because "the desktop must show (in front: $(Get-E2eForegroundText))"
                # The second press goes where the first left the keyboard: the desktop.
                Invoke-E2eCaseKey $ctx -FrontDesktop
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
                Needs   = @{ Why = 'needs a second monitor'; Met = { [System.Windows.Forms.Screen]::AllScreens.Count -ge 2 } }
                Arrange = { param($ctx) Reset-E2eStandinA; $ctx.Screen = [System.Windows.Forms.Screen]::FromHandle($ctx.Run.Standins['A'].Hwnd).DeviceName }
                Assert  = {
                    param($ctx)
                    (Wait-E2eCondition { [System.Windows.Forms.Screen]::FromHandle($ctx.Run.Standins['A'].Hwnd).DeviceName -ne $ctx.Screen } -TimeoutMs 4000) | Should -BeTrue -Because 'the active window must move to another monitor'
                    Wait-ScreenChange -Observed
                }
                CleanUp = { param($ctx) Reset-E2eStandinA }
            }
        }
        # Task View, Snap Assist and Alt+Tab are all windows of explorer.exe of the class
        # XamlExplorerHostIslandWindow; only the title, which Windows translates, tells them apart
        # ('Task View', 'Snap Assist', 'Task Switching' in English).
        @{ Command = 'TaskView'; File = 'windows'; Kind = 'Custom'; Targets = 'explorer.exe'
            Needs   = @{ Why = 'needs an English display language: only the title of Task View (translated) tells it from Snap Assist and Alt+Tab, windows of the same class'; Met = { [System.Globalization.CultureInfo]::CurrentUICulture.Name -like 'en*' } }
            Arrange = { param($ctx) Reset-E2eStandinA }
            Assert  = {
                param($ctx)
                $ctx.Overlay = Wait-E2eCondition { $f = [Macropad.WindowApi]::Foreground(); $i = Get-WindowInfo $f; if ($i.Exe -eq 'explorer.exe' -and $i.Class -eq 'XamlExplorerHostIslandWindow' -and $i.Title -eq 'Task View') { $f } } -TimeoutMs 4000
                $ctx.Overlay | Should -Not -BeNullOrEmpty -Because "Task View must open (in front: $(Get-E2eForegroundText))"
                Wait-ScreenChange -Observed
            }
            CleanUp = { param($ctx) Close-E2eShellOverlay $ctx.Overlay; Reset-E2eStandinA }
        }
        # Print Screen opens the screen capture over the whole screen or copies a screenshot to the
        # clipboard (a setting chooses), Alt+Print Screen replaces the clipboard: the keys are checked.
        @{ Command = 'PrintScreen'; File = 'windows'; Kind = 'Watch' }
        @{ Command = 'PrintActiveWindow'; File = 'windows'; Kind = 'Watch' }
        @{ Command = 'SnippingTool'; File = 'windows'; Kind = 'Custom'; Targets = 'ScreenClippingHost.exe', 'SnippingTool.exe'
            Needs   = @{ Why = 'needs the Snipping Tool, the app that opens ms-screenclip:, which a Windows may not have'; Met = { Test-Path 'Registry::HKEY_CLASSES_ROOT\ms-screenclip' } }
            Arrange = { param($ctx) Reset-E2eStandinA }
            Assert  = {
                param($ctx)
                $ctx.Overlay = Wait-E2eCondition { $f = [Macropad.WindowApi]::Foreground(); if ((Get-WindowInfo $f).Exe -in 'ScreenClippingHost.exe', 'SnippingTool.exe') { $f } } -TimeoutMs 8000
                $ctx.Overlay | Should -Not -BeNullOrEmpty -Because "the screen capture must open (in front: $(Get-E2eForegroundText))"
                Wait-ScreenChange -Observed
            }
            CleanUp = { param($ctx) Close-E2eShellOverlay $ctx.Overlay; Reset-E2eStandinA }
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
        @{ Command = 'OpenYoutube'; File = 'custom\chrome'; Kind = 'Custom'; Targets = 'chrome.exe'; Arrange = $script:E2eFromB; Assert = { param($ctx) Assert-E2eChromeUrl $ctx 'https://www.youtube.com/' } }
        @{ Command = 'OpenGoogle'; File = 'custom\chrome'; Kind = 'Custom'; Targets = 'chrome.exe'; Arrange = $script:E2eFromB; Assert = { param($ctx) Assert-E2eChromeUrl $ctx 'https://www.google.com/' } }
        foreach ($c in 'ChromePreviousTab', 'ChromeNextTab', 'ChromeDevTools', 'ChromeCloseTab', 'ChromeReopenClosedTab', 'ChromeBookmarkPage', 'ActivateOrCycleChromeAddressBar') { @{ Command = $c; File = 'custom\chrome' } }

        # ---- custom\examples ----
        @{ Command = 'ExampleOpenWebsite'; File = 'custom\examples'; Kind = 'Custom'; Targets = 'chrome.exe'; Arrange = $script:E2eFromB; Assert = { param($ctx) Assert-E2eChromeUrl $ctx 'https://example.com/' } }
        (New-E2eOpenerCase 'ExampleOpenProgram' 'custom\examples' 'ahk_exe notepad.exe' -Targets 'notepad.exe' -SkipIf {
                if ((Get-E2eForeignWindows 'ahk_exe notepad.exe').Count -gt 0) { 'a Notepad the test did not open is on the desktop; the key would bring it forward' }
            })

        # ---- custom\ssh ----
        @{ Command = 'SshMacroDescription'; File = 'custom\ssh'; Kind = 'Custom'; Macro = @{ name = 'SSH'; description = 'e2e desc test' }; Targets = 'putty.exe'
            Arrange = $script:E2eFromB
            Assert  = { param($ctx) Assert-E2eLaunch $ctx 'putty.exe' '-load "e2e desc test"' -Front $ctx.Run.Standins['P'].Hwnd -TimeoutMs 16000 }
        }
        @{ Command = 'SshExample'; File = 'custom\ssh'; Kind = 'Custom'; Targets = 'ssh.exe'
            Arrange = $script:E2eFromB
            Assert  = { param($ctx) Assert-E2eLaunch $ctx 'ssh.exe' 'user@server.example.com' }
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
