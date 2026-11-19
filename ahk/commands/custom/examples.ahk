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
 * Opens or activates Calculator. It is a Store app: its window belongs to ApplicationFrameHost.exe and its title is translated, so it is found by the app's application id, in any display language. In PowerShell, Get-StartApps lists the application id of every installed app.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
OpenCalculator(Macro) {
    ActivateOrOpenApp("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", "calc.exe")
}

/**
 * Example: opens your Documents folder in File Explorer, wherever Windows keeps it, and brings the new window to the front: the pattern for any folder or share.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ExampleOpenFolder(Macro) {
    before := "|"
    for hwnd in WinGetList("ahk_class CabinetWClass")  ; the File Explorer windows open now
        before .= hwnd "|"
    Run('explorer.exe "' A_MyDocuments '"')
    Loop 50 {  ; look for the new window for about 5 seconds
        for hwnd in WinGetList("ahk_class CabinetWClass") {
            if !InStr(before, "|" hwnd "|") {
                WinActivate("ahk_id " hwnd)
                return
            }
        }
        Sleep(100)
    }
}
