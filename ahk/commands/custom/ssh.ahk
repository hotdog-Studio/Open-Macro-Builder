#Requires AutoHotkey v2.0

; *********************** SSH Functions *********************
; Generic SSH commands. Commands for your own servers belong in ..\..\..\local\ahk, which git
; ignores (see the readme).

/**
 * Load a putty session by name
 * @param {(String)} Name String - Name of the putty session to load
 */
LoadPuttySession(Name) {
    window := "ahk_exe putty.exe"
    Run('cmd /c "start putty -load ' Name '"',,"Hide") ;use cmd in hidden mode to launch requested program
    WinWait(window,,,15)		; wait up to 15 seconds for window to exist
    if WinActive(window) {
        WinActivateBottom window ; Uses the last found window.
    }
    else {
        WinActivate  ; Uses the last found window.
    }
}

/**
 * Load the putty session named like the macro: name a macro after a saved session.
 * @param {Macro} Macro - The macro whose name is the session name.
 */
SshMacroName(Macro) {
    LoadPuttySession(macro.name)
}

/**
 * Load the putty session named in the macro's description.
 * @param {Macro} Macro - The macro whose description is the session name.
 */
SshMacroDescription(Macro) {
    LoadPuttySession(macro.description)
}

/**
 * Example: opens an SSH session with Windows' own ssh client in a new console window.
 * Copy it for each server, with your own user and host.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
SshExample(Macro) {
    Run('ssh user@server.example.com')
}
