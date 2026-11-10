#Requires AutoHotkey v2.0

; *********************** Helper Functions *********************
/**
 * Opens or activates Google Chrome. If a URL is provided, opens Chrome with that URL.
 * @param {(String)} Url (optional) If provided, opens Chrome with this URL.
 */
ActivateOrOpenChrome(Url := "")
{
    ; check if window exists
    window := "ahk_exe chrome.exe"
    program := "chrome.exe"
    if !WinExist(window) || Url
    {   ; else start requested program
        if (Url)
            Run('cmd /c "start ^"^" ^"' program '^" ' Url '"',,"Hide") ;use cmd in hidden mode to launch requested program
        else
            Run('cmd /c "start ^"^" ^"' program '^""',,"Hide") ;use cmd in hidden mode to launch requested program
        WinWait(window,,,5)		; wait up to 5 seconds for window to exist
        IfWinNotActive(window)
        {
            WinActivate  ; Uses the last found window.
        }
    }
    else
    {      
        if WinActive(window) {
            WinActivateBottom window ; Uses the last found window.
        }
        else {
            WinActivate  ; Uses the last found window.
        }
    }
   return
}

/**
 * Ensures Google Chrome is active or opens it if not already running.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
EnsureActiveOrOpenChrome(Macro)
{
    ; check if window exists
    window := "ahk_exe chrome.exe"
    program := "chrome.exe"
    EnsureActiveOrOpen(window, program, "")
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
 * Opens Gmail in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
OpenGmail1(Macro)
{
    ActivateOrOpenChrome("https://mail.google.com/mail/u/0/#inbox")
}


/**
 * Opens Gmail in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
OpenGmail2(Macro)
{
    ActivateOrOpenChrome("https://mail.google.com/mail/u/0/#inbox")
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
    EnsureActiveOrOpenChrome(Macro)
    Send("{Ctrl Down}t{Ctrl Up}")
}

/**
 * Opens a new tab in the current tab group in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeNewTabInGroup(Macro) {
    EnsureActiveOrOpenChrome(Macro)
    Send("{LAlt Down}{Shift Down}t{Shift Up}{LAlt Up}")
}

/**
 * Opens a new window in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenNewWindow(Macro) {
    EnsureActiveOrOpenChrome(Macro)
    Send("{Ctrl Down}n{Ctrl Up}")
}

/**
 * Opens a new incognito window in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenIncognitoWindow(Macro) {
    EnsureActiveOrOpenChrome(Macro)
    Send("{Ctrl Down}{Shift Down}n{Shift Up}{Ctrl Up}")
}

/**
 * Opens the downloads page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenDownloads(Macro) {
    EnsureActiveOrOpenChrome(Macro)
    Send("{Ctrl Down}j{Ctrl Up}")
}

/**
 * Opens the browsing history page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenHistory(Macro) {
    EnsureActiveOrOpenChrome(Macro)
    Send("{Ctrl Down}h{Ctrl Up}")
}

/**
 * Opens the bookmarks manager in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenBookmarks(Macro) {
    EnsureActiveOrOpenChrome(Macro)
    Send("{Ctrl Down}{Shift Down}o{Shift Up}{Ctrl Up}")
}

/**
 * Opens the extensions page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenExtensions(Macro) {
    EnsureActiveOrOpenChrome(Macro)
    Send("{Ctrl Down}{Shift Down}e{Shift Up}{Ctrl Up}")
}

/**
 * Opens the settings page in Google Chrome.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ChromeOpenSettings(Macro) {
    EnsureActiveOrOpenChrome(Macro)
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