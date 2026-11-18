#Requires AutoHotkey v2.0
; Commands for the end-to-end test (powershell\tests\EndToEnd.Tests.ps1) only. The test starts the real
; macropad with this file included before ahk\main.ahk (AutoHotkey's /include switch), so the test's
; layout can put these on keys beside the shared commands. OMB_E2E_DIR names the run's folder.
; commands.ps1 beside this file has the same commands for the PowerShell macropad.

; A runtime error is written to the run's errors.log, which the test reads after every case, instead
; of opening a dialog that would stay on the screen.
OnError(E2eLogError)

E2eDir() {
    return EnvGet("OMB_E2E_DIR")
}

E2eLogError(Err, Mode) {
    try FileAppend("error in " Err.What ": " Err.Message "`n", E2eDir() "\errors.log", "UTF-8-RAW")
    return 1
}

E2eWrite(File, Line) {
    FileAppend(Line "`n", E2eDir() "\" File, "UTF-8-RAW")
}

/**
 * Writes the macro's name to marks.log: the test presses it until the macropad answers.
 * @param {Macro} Macro - Its name is written.
 */
E2eMark(Macro) {
    E2eWrite("marks.log", Macro.name)
}

/**
 * Ends the macropad, as its tray menu's Exit does.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eExit(Macro) {
    ExitApp()
}
