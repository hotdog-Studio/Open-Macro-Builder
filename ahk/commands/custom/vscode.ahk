#Requires AutoHotkey v2.0

; *********************** VS Code Functions *********************
/**
 * Shows or hides the panel below the editors (Terminal, Problems, Output, Debug Console) (Ctrl+J).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeToggleBottomPanel(Macro) {
    Send("{Ctrl Down}j{Ctrl Up}")
}

/**
 * Shows or hides the sidebar (Ctrl+B).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeToggleSidebar(Macro) {
    Send("{Ctrl Down}b{Ctrl Up}")
}

/**
 * Turns Zen Mode on or off (Ctrl+K, then Z).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeToggleZenMode(Macro) {
    Send("{Ctrl Down}k{Ctrl Up}")
    Sleep 100
    Send("z")
}

/**
 * Closes the current editor (Ctrl+W).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeCloseEditor(Macro) {
    Send("{Ctrl Down}w{Ctrl Up}")
}

/**
 * Reopens the editor closed last (Ctrl+Shift+T).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeReopenClosedEditor(Macro) {
    Send("{Ctrl Down}{Shift Down}t{Shift Up}{Ctrl Up}")
}

/**
 * Switches to the next editor tab (Ctrl+PgDn).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeNextEditor(Macro) {
    Send("{Ctrl Down}{PgDn}{Ctrl Up}")
}

/**
 * Switches to the previous editor tab (Ctrl+PgUp).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodePreviousEditor(Macro) {
    Send("{Ctrl Down}{PgUp}{Ctrl Up}")
}

/**
 * Moves the focus into the editor group on the right (Ctrl+K, then Ctrl+Right).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeNextGroup(Macro) {
    Send("{Ctrl Down}k{Ctrl Up}")
    Sleep 100
    Send("{Ctrl Down}{Right}{Ctrl Up}")
}

/**
 * Moves the focus into the editor group on the left (Ctrl+K, then Ctrl+Left).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodePreviousGroup(Macro) {
    Send("{Ctrl Down}k{Ctrl Up}")
    Sleep 100
    Send("{Ctrl Down}{Left}{Ctrl Up}")
}

/**
 * Moves the active editor group to the left (Ctrl+K, then Left).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeMoveGroupLeft(Macro) {
    Send("{Ctrl Down}k{Ctrl Up}")
    Sleep 100
    Send("{Left}")
}

/**
 * Moves the active editor group to the right (Ctrl+K, then Right).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeMoveGroupRight(Macro) {
    Send("{Ctrl Down}k{Ctrl Up}")
    Sleep 100
    Send("{Right}")
}

/**
 * Shows the Search view, to search in files (Ctrl+Shift+F).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeSearchInFiles(Macro) {
    Send("{Ctrl Down}{Shift Down}f{Shift Up}{Ctrl Up}")
}

/**
 * Moves the current editor into the next editor group (Ctrl+Alt+Right).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeMovePanelRight(Macro) {
    Send("{Ctrl Down}{LAlt Down}{Right}{LAlt Up}{Ctrl Up}")
}

/**
 * Moves the current editor into the previous editor group (Ctrl+Alt+Left).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeMovePanelLeft(Macro) {
    Send("{Ctrl Down}{LAlt Down}{Left}{LAlt Up}{Ctrl Up}")
}

/**
 * Opens the Source Control view (Ctrl+Shift+G).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeOpenSourceControl(Macro) {
    Send("{Ctrl Down}{Shift Down}g{Shift Up}{Ctrl Up}")
}

/**
 * Splits the current editor (Ctrl+\).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeSplitPanel(Macro) {
    Send("{Ctrl Down}\{Ctrl Up}")
}

/**
 * Opens the Command Palette (Ctrl+Shift+P).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeOpenCommandPalette(Macro) {
    Send("{Ctrl Down}{Shift Down}p{Shift Up}{Ctrl Up}")
}

/**
 * Opens a new terminal (Ctrl+Shift+backtick).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeOpenTerminal(Macro) {
    Send("{Ctrl Down}{Shift Down}``{Shift Up}{Ctrl Up}")  ; `` is one backtick
}

/**
 * Starts debugging, or continues when paused (F5).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeDebug(Macro) {
    Send("{F5}")
}

; *********************** Debugger Functions *********************

/**
 * Sets or removes a breakpoint on the current line (F9).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeAddBreakpoint(Macro) {
    Send("{F9}")
}

/**
 * Sets an inline breakpoint at the cursor, during a debugging session (Shift+F9).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeAddInlineBreakpoint(Macro) {
    Send("{Shift Down}{F9}{Shift Up}")
}

/**
 * Stops debugging (Shift+F5).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeStopDebugging(Macro) {
    Send("{Shift Down}{F5}{Shift Up}")
}

/**
 * Restarts the debugging session (Ctrl+Shift+F5).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeRestartDebugging(Macro) {
    Send("{Ctrl Down}{Shift Down}{F5}{Shift Up}{Ctrl Up}")
}

/**
 * Pauses the program being debugged (F6).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodePauseDebugging(Macro) {
    Send("{F6}")
}

/**
 * Steps into the function called on the current line (F11).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeStepInto(Macro) {
    Send("{F11}")
}

/**
 * Steps out of the current function (Shift+F11).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeStepOut(Macro) {
    Send("{Shift Down}{F11}{Shift Up}")
}

/**
 * Steps over the current line (F10).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeStepOver(Macro) {
    Send("{F10}")
}

; *********************** Go to *********************
/**
 * Goes to the definition of the symbol at the cursor (F12).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeGoToDefinition(Macro) {
    Send("{F12}")
}

/**
 * Shows the definition of the symbol at the cursor in a peek window (Alt+F12).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodePeekDefinition(Macro) {
    Send("{Alt Down}{F12}{Alt Up}")
}

/**
 * Lists the references to the symbol at the cursor (Shift+F12).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeGoToReferences(Macro) {
    Send("{Shift Down}{F12}{Shift Up}")
}

/**
 * Lists the implementations of the symbol at the cursor in a peek window (Ctrl+Shift+F12).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodePeekImplementations(Macro) {
    Send("{Ctrl Down}{Shift Down}{F12}{Shift Up}{Ctrl Up}")
}

/**
 * Goes to the implementation of the symbol at the cursor (Ctrl+F12).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsCodeGoToImplementation(Macro) {
    Send("{Ctrl Down}{F12}{Ctrl Up}")
}
