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
