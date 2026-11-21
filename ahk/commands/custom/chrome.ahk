#Requires AutoHotkey v2.0

; *********************** Helper Functions *********************
/**
 * Switches to Google Chrome or starts it, or opens a web address in Chrome. Without Url, a Chrome window is activated (the bottom one when a Chrome window is already active, so pressing the key again steps through Chrome's windows), and Chrome is started only when it has no window. With Url, Chrome is started every time with the address on its command line, and a Chrome window is activated once one is there (up to 5 seconds).
 * @param {String} [Url=""] - The web address to open, such as "https://www.google.com/"; & and % in it are fine. Leave it out to switch to Chrome.
 * @example ActivateOrOpenChrome("https://www.youtube.com/")
 */
ActivateOrOpenChrome(Url := "")
{
    if (Url != "")
        Open("ahk_exe chrome.exe", "chrome.exe", '"' Url '"')
    else
        ActivateOrOpen("ahk_exe chrome.exe", "chrome.exe")
}

/**
 * Makes a Google Chrome window the active window, starting Chrome when it has none.
 * @param {Macro} Macro - The macro object (not used in this function).
 * @returns {Boolean} True when a Chrome window is the active window at the end; the Chrome commands send their keys only then.
 */
EnsureActiveOrOpenChrome(Macro)
{
    return EnsureActiveOrOpen("ahk_exe chrome.exe", "chrome.exe")
}

; *********************** Browsing/Chrome Functions *********************
/**
 * Opens YouTube in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
OpenYoutube(Macro)
{
    ActivateOrOpenChrome("https://www.youtube.com/")
}

/**
 * Opens Google in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
OpenGoogle(Macro)
{
    ActivateOrOpenChrome("https://www.google.com/")
}

/**
 * Opens or activates Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpen(Macro) {
    ActivateOrOpenChrome()
}

/**
 * Opens a new tab in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeNewTab(Macro) {
    if EnsureActiveOrOpenChrome(Macro)
        Send("{Ctrl Down}t{Ctrl Up}")
}

/**
 * Opens a new tab in Google Chrome inside the tab group of the active tab, right after it, as "New tab to the right" in the tab's right-click menu does. When the active tab is in no group, the new tab opens right after it, in no group. The address bar of the new tab has the keyboard, as after Ctrl+T. Chrome has no keyboard shortcut for this, so no key is pressed: the command posts Chrome's own command for it to the active Chrome window. It works in any display language, with no extension and no change to Chrome's settings. Nothing happens while a bubble or dialog of Chrome's has the keyboard, such as the one the bookmark star opens.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeNewTabInGroup(Macro) {
    ; WM_COMMAND (0x111) with IDC_NEW_TAB_TO_RIGHT (35024, chrome/app/chrome_command_ids.h in Chromium), which
    ; Chrome runs on the active tab of the window that gets it: the tab menu's "New tab to the right", which puts the
    ; new tab in the active tab's group. Posted, so a busy Chrome never holds the macropad up.
    if EnsureActiveOrOpenChrome(Macro) && (chrome := WinActive("ahk_exe chrome.exe"))
        PostMessage(0x111, 35024, 0, , chrome)
}

/**
 * Opens a new window in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenNewWindow(Macro) {
    if EnsureActiveOrOpenChrome(Macro)
        Send("{Ctrl Down}n{Ctrl Up}")
}

/**
 * Opens a new incognito window in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenIncognitoWindow(Macro) {
    if EnsureActiveOrOpenChrome(Macro)
        Send("{Ctrl Down}{Shift Down}n{Shift Up}{Ctrl Up}")
}

/**
 * Opens the downloads page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenDownloads(Macro) {
    if EnsureActiveOrOpenChrome(Macro)
        Send("{Ctrl Down}j{Ctrl Up}")
}

/**
 * Opens the browsing history page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenHistory(Macro) {
    if EnsureActiveOrOpenChrome(Macro)
        Send("{Ctrl Down}h{Ctrl Up}")
}

/**
 * Opens the bookmarks manager in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenBookmarks(Macro) {
    if EnsureActiveOrOpenChrome(Macro)
        Send("{Ctrl Down}{Shift Down}o{Shift Up}{Ctrl Up}")
}

/**
 * Opens the extensions page in Google Chrome, through the address bar (Chrome has no shortcut for it).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenExtensions(Macro) {
    if EnsureActiveOrOpenChrome(Macro) {
        Send("{Ctrl Down}l{Ctrl Up}")
        Sleep 100  ; give the address bar a moment to take the keys
        SendText("chrome://extensions")
        Send("{Enter}")
    }
}

/**
 * Opens the settings page in Google Chrome, through the address bar (Chrome has no shortcut for it).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenSettings(Macro) {
    if EnsureActiveOrOpenChrome(Macro) {
        Send("{Ctrl Down}l{Ctrl Up}")
        Sleep 100  ; give the address bar a moment to take the keys
        SendText("chrome://settings")
        Send("{Enter}")
    }
}

/**
 * Switches to the previous tab in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromePreviousTab(Macro) {
    Send("{Ctrl Down}{Shift Down}{Tab}{Shift Up}{Ctrl Up}")
}

/**
 * Switches to the next tab in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeNextTab(Macro) {
    Send("{Ctrl Down}{Tab}{Ctrl Up}")
}

/**
 * Opens Chrome Developer Tools.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeDevTools(Macro) {
    Send("{Ctrl Down}{Shift Down}i{Shift Up}{Ctrl Up}")
}

/**
 * Closes the current tab in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeCloseTab(Macro) {
    Send("{Ctrl Down}w{Ctrl Up}")
}

/**
 * Reopens the last closed tab in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeReopenClosedTab(Macro) {
    Send("{Ctrl Down}{Shift Down}t{Shift Up}{Ctrl Up}")
}

/**
 * Bookmarks the current page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeBookmarkPage(Macro) {
    Send("{Ctrl Down}d{Ctrl Up}")
}

/**
 * Activates or cycles to the address bar in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ActivateOrCycleChromeAddressBar(Macro) {
    Send("{Ctrl Down}l{Ctrl Up}")
}