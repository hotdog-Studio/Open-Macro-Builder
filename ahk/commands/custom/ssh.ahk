#Requires AutoHotkey v2.0

; *********************** SSH Functions *********************
; Generic SSH commands. Commands for your own servers belong in ..\..\..\local\ahk, which git
; ignores (see the readme).

/**
 * Starts a session saved in PuTTY, then brings a PuTTY window forward: PuTTY is started with -load and the session's name in double quotes, then up to 15 seconds are given for a PuTTY window, and the topmost one is activated, or the bottom one when a PuTTY window is already active. If no window appears in time, nothing is activated.
 * @param {String} Name - The name of a saved session, as PuTTY's Saved Sessions list shows it. Spaces in the name are fine.
 * @example LoadPuttySession("my-server")
 */
LoadPuttySession(Name) {
    window := "ahk_exe putty.exe"
    Run('"putty.exe" -load "' Name '"')
    if WinWait(window,,15)  ; 0 when no window appeared in 15 seconds
    {
        if WinActive(window)
            WinActivateBottom window
        else
            WinActivate  ; the window WinWait found
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
