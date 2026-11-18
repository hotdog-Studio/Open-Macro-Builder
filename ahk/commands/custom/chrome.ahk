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
 * Opens the extensions page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenExtensions(Macro) {
    if EnsureActiveOrOpenChrome(Macro)
        Send("{Ctrl Down}{Shift Down}e{Shift Up}{Ctrl Up}")
}

/**
 * Opens the settings page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenSettings(Macro) {
    if EnsureActiveOrOpenChrome(Macro)
        Send("{Alt Down}e{Alt Up}g")
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