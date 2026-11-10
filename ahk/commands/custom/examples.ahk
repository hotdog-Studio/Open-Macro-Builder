#Requires AutoHotkey v2.0

; *********************** Example Functions *********************
; Small, generic commands to copy from. Your own commands belong in ..\..\..\local\ahk, which git
; ignores (see the readme), so personal paths, hosts and accounts stay on your PC.

/**
 * Example: opens a website in Google Chrome, reusing a running Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ExampleOpenWebsite(Macro) {
    ActivateOrOpenChrome("https://example.com/")
}

/**
 * Example: opens or activates Notepad, the pattern for any program.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ExampleOpenProgram(Macro) {
    ActivateOrOpen("ahk_exe notepad.exe", "notepad.exe", "")
}

/**
 * Opens or activates Calculator.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
OpenCalculator(Macro) {
    ActivateOrOpen("ahk_exe Calculator.exe", "C:\Windows\System32\calc.exe", "")
}

/**
 * Example: opens your Documents folder in File Explorer, the pattern for any folder or share.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ExampleOpenFolder(Macro) {
    Run('explorer.exe "' EnvGet("USERPROFILE") '\Documents"')
}
