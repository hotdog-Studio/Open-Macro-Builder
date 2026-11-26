# Commands for the end-to-end test (powershell\tests\EndToEnd.Tests.ps1) only. The test starts the real
# macropad with this file loaded first (powershell.exe -Command ". commands.ps1; . main.ps1"), so the
# test's layout can put these on keys beside the shared commands. OMB_E2E_DIR names the run's folder.
# commands.ahk beside this file has the same commands for the AutoHotkey macropad.

# A line for the test, which reads these files while the macropad writes them. The file is opened
# sharing reading and writing, as the test's reader opens it, so neither is refused when both have it
# at the same moment. Not Add-Content: in Windows PowerShell 5.1 it shares only writing, so it is
# refused while the test reads, and can then keep the file open, refusing every reader, until its
# process next collects garbage.
function E2eWrite {
    param([string]$File, [string]$Line)
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes("$Line`n")
    $stream = [System.IO.FileStream]::new((Join-Path $env:OMB_E2E_DIR $File), 'Append', 'Write', 'ReadWrite')
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}

# Does nothing: the test presses its key until the macropad's command log (Invoke-EngineMacro in
# powershell\lib\Engine.ps1) says that it ran to its end.
function E2eMark { param($Macro) }

# Does nothing, for a case whose subject is not its own key: the overlay cases click the overlay, and
# read in the macropad's command log that a click on a key's label ran that key's command.
function E2eNothing { param($Macro) }

# The action of the hotkeys and hotstrings of the test's layout ("hotkeys", "hotstrings"): appends the
# name of its macro, which is the hotkey or the hotstring as the layout writes it ('^!F9', ':X:e2erun'),
# to the run's hotkeys.log, as commands.ahk does.
function E2eHotkey { param($Macro) E2eWrite 'hotkeys.log' $Macro.Name }

# Ends the macropad, as its tray menu's Exit does.
function E2eExit {
    param($Macro)
    $global:MacropadExiting = $true
    [System.Windows.Forms.Application]::Exit()
}

# ---- Helpers that no shared command calls with the arguments their fixes are about ----

function E2eTestDir { Join-Path $env:OMB_E2E_DIR 'E2E Test' }
function E2eLauncher { Join-Path $env:OMB_E2E_DIR 'path\e2eapp.exe' }

# The script helpers, with arguments a command line could break: an &, several arguments, none, and 0.
# One at a time, two seconds apart, so that their console windows do not flash.
function E2eRunScripts {
    param($Macro)
    $dir = E2eTestDir
    RunPythonScript "$dir\write.py" -Arguments '--quick a&b'
    Wait-Pump 2000
    RunPowerShellScript "$dir\write.ps1" -Arguments '-A one two'
    Wait-Pump 2000
    RunPowerShellScript "$dir\write.ps1"
    Wait-Pump 2000
    RunBatchScript "$dir\args.bat" -Arguments 'one two three many'
    Wait-Pump 2000
    RunBatchScript "$dir\args.bat" -Arguments '0'
}

# An & in the arguments of a program reaches the program.
function E2eAmpersand {
    param($Macro)
    ActivateOrOpen 'e2e-never.exe' 'pythonw' -Arguments ("-c `"open(r'{0}\amp.txt','w').write('a&b')`"" -f (E2eTestDir))
}

# A program whose path has spaces, with an argument in quotes that has a space.
function E2eOpenSpaces {
    param($Macro)
    $dir = E2eTestDir
    ActivateOrOpen 'e2e app.exe' "$dir\e2e app.exe" -Arguments "`"$dir\note a.txt`""
}

# EnsureActiveOrOpen says whether the window is active at the end.
function E2eEnsureActive {
    param($Macro)
    $r = EnsureActiveOrOpen 'e2eapp.exe' (E2eLauncher)
    E2eWrite 'marks.log' "ensure $([int][bool]$r)"
}

# Open, ActivateOrOpen and EnsureActiveOrOpen with a program that shows no window: no error, nothing
# activated, and EnsureActiveOrOpen says false.
function E2eNeverAppears {
    param($Macro)
    Open 'e2e-never.exe' (E2eLauncher) -Arguments '--no-window'
    ActivateOrOpen 'e2e-never.exe' (E2eLauncher) -Arguments '--no-window'
    $r = EnsureActiveOrOpen 'e2e-never.exe' (E2eLauncher) -Arguments '--no-window'
    E2eWrite 'marks.log' "never $([int][bool]$r)"
}

# ActivateOrOpen brings the top window of the program forward, then the bottom one. The test presses
# the key again only when the macropad's command log says that the command has returned (see
# commands.ahk).
function E2eStep {
    param($Macro)
    ActivateOrOpen 'e2eapp.exe' (E2eLauncher)
}

# Chrome gets an address with & in it whole, and comes forward.
function E2eChromeUrl { param($Macro) ActivateOrOpenChrome 'https://example.com/?a=1&b=2' }

# Open-ExplorerWindow shows a folder whose name has a comma and a space (PowerShell only: the
# AutoHotkey version has no such helper).
function E2eOpenFolderComma { param($Macro) Open-ExplorerWindow (Join-Path (E2eTestDir) 'Smith, John') }
