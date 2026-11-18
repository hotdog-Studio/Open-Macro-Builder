# Commands for the end-to-end test (powershell\tests\EndToEnd.Tests.ps1) only. The test starts the real
# macropad with this file loaded first (powershell.exe -Command ". commands.ps1; . main.ps1"), so the
# test's layout can put these on keys beside the shared commands. OMB_E2E_DIR names the run's folder.
# commands.ahk beside this file has the same commands for the AutoHotkey macropad.

function E2eWrite {
    param([string]$File, [string]$Line)
    Add-Content -LiteralPath (Join-Path $env:OMB_E2E_DIR $File) -Value $Line -Encoding UTF8
}

# Writes the macro's name to marks.log: the test presses it until the macropad answers.
function E2eMark { param($Macro) E2eWrite 'marks.log' $Macro.Name }

# Ends the macropad, as its tray menu's Exit does.
function E2eExit {
    param($Macro)
    $global:MacropadExiting = $true
    [System.Windows.Forms.Application]::Exit()
}

# ---- Helpers that no shared command calls with the arguments their fixes are about ----

function E2eTestDir { Join-Path $env:OMB_E2E_DIR 'E2E Test' }
function E2eLauncher { Join-Path $env:OMB_E2E_DIR 'path\e2eapp.exe' }

# AHK-1, AHK-2 twins: the script helpers, with arguments a command line could break. One at a time,
# two seconds apart, so that their console windows do not flash.
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
    E2eWrite 'marks.log' 'scripts started'
}

# An & in the arguments of a program reaches the program.
function E2eAmpersand {
    param($Macro)
    ActivateOrOpen 'e2e-never.exe' 'pythonw' -Arguments ("-c `"open(r'{0}\amp.txt','w').write('a&b')`"" -f (E2eTestDir))
    E2eWrite 'marks.log' 'ampersand done'
}

# A program whose path has spaces, with an argument in quotes that has a space.
function E2eOpenSpaces {
    param($Macro)
    $dir = E2eTestDir
    ActivateOrOpen 'e2e app.exe' "$dir\e2e app.exe" -Arguments "`"$dir\note a.txt`""
}

# PS-8: EnsureActiveOrOpen says whether the window is active at the end.
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

# ActivateOrOpen brings the top window of the program forward, then the bottom one.
function E2eStep { param($Macro) ActivateOrOpen 'e2eapp.exe' (E2eLauncher) }

# Chrome gets an address with & in it whole, and comes forward.
function E2eChromeUrl { param($Macro) ActivateOrOpenChrome 'https://example.com/?a=1&b=2' }

# PS-9: Open-ExplorerWindow shows a folder whose name has a comma and a space (PowerShell only: the
# AutoHotkey version has no such helper).
function E2eOpenFolderComma { param($Macro) Open-ExplorerWindow (Join-Path (E2eTestDir) 'Smith, John') }
