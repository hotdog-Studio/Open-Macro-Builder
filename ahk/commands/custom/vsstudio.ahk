#Requires AutoHotkey v2.0

; *********************** Visual Studio Functions *********************
/**
 * Shows or hides the Solution Explorer.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsStudioShowSolutionExplorer(Macro) {
    Send("{Ctrl Down}{Alt Down}l{Alt Up}{Ctrl Up}")
}

/**
 * Shows the Test Explorer (Ctrl+E, T: Ctrl+E, then T without Ctrl).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsStudioShowTestExplorer(Macro) {
    Send("{Ctrl Down}e{Ctrl Up}t")
}

/**
 * Splits the Panel.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsStudioSplitPanel(Macro) {
    Send("{Ctrl Down}{w Down}v{w Up}{Ctrl Up}")
}

/**
 * Builds the solution.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsStudioBuild(Macro) {
    Send("{Ctrl Down}{Shift Down}b{Shift Up}{Ctrl Up}")
}

/**
 * Goes to the definition of the selected item.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
VsStudioGoToDefinition(Macro) {
    Send("{F12}")
}

; *********************** Debugger Functions *********************