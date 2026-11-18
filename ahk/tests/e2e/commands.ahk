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

; ---- Helpers that no shared command calls with the arguments their fixes are about ----

E2eTestDir() {
    return E2eDir() "\E2E Test"
}

E2eLauncher() {
    return E2eDir() "\path\e2eapp.exe"
}

/**
 * AHK-1, AHK-2: the script helpers, with arguments a command line could break. One at a time, two
 * seconds apart, so that their console windows do not flash.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eRunScripts(Macro) {
    dir := E2eTestDir()
    RunPythonScript(dir "\write.py", "--quick a&b")
    Sleep(2000)
    RunPowerShellScript(dir "\write.ps1", "-A one two")
    Sleep(2000)
    RunPowerShellScript(dir "\write.ps1")
    Sleep(2000)
    RunBatchScript(dir "\args.bat", "one two three many")
    Sleep(2000)
    RunBatchScript(dir "\args.bat", "0")
    E2eWrite("marks.log", "scripts started")
}

/**
 * AHK-2: an & in the arguments of a program reaches the program.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eAmpersand(Macro) {
    ActivateOrOpen("ahk_exe e2e-never.exe", "pythonw", "-c `"open(r'" E2eTestDir() "\amp.txt','w').write('a&b')`"")
    E2eWrite("marks.log", "ampersand done")
}

/**
 * AHK-2: a program whose path has spaces, with an argument in quotes that has a space.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eOpenSpaces(Macro) {
    ActivateOrOpen("ahk_exe e2e app.exe", E2eTestDir() "\e2e app.exe", '"' E2eTestDir() '\note a.txt"')
}

/**
 * AHK-3 (called with two arguments) and the PS-8 twin: EnsureActiveOrOpen says whether the window is
 * active at the end.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eEnsureActive(Macro) {
    r := EnsureActiveOrOpen("ahk_exe e2eapp.exe", E2eLauncher())
    E2eWrite("marks.log", "ensure " r)
}

/**
 * AHK-4 and the PS-8 twin: Open, ActivateOrOpen and EnsureActiveOrOpen with a program that shows no
 * window: no error, nothing activated, and EnsureActiveOrOpen says 0.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eNeverAppears(Macro) {
    Open("ahk_exe e2e-never.exe", E2eLauncher(), "--no-window")
    ActivateOrOpen("ahk_exe e2e-never.exe", E2eLauncher(), "--no-window")
    r := EnsureActiveOrOpen("ahk_exe e2e-never.exe", E2eLauncher(), "--no-window")
    E2eWrite("marks.log", "never " r)
}

/**
 * AHK-5: ActivateOrOpen brings the top window of the program forward, then the bottom one.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eStep(Macro) {
    ActivateOrOpen("ahk_exe e2eapp.exe", E2eLauncher())
}

/**
 * AHK-2, AHK-12, AHK-13: Chrome gets an address with & in it whole, and comes forward.
 * @param {Macro} Macro - The macro object (not used).
 */
E2eChromeUrl(Macro) {
    ActivateOrOpenChrome("https://example.com/?a=1&b=2")
}
