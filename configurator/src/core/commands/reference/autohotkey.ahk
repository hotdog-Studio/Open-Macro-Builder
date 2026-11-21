; AutoHotkey's own functions, as the Commands tab of the configurator describes them: the card that
; shows when the pointer rests on a name, and the list of what a command can call.
;
; This file is never run and never written to a folder. Each function below is an empty declaration
; with a doc block, which the configurator reads with the parser that reads the command files. The
; parameter names and their order are AutoHotkey's; the wording is this project's own, checked
; against each function's page in AutoHotkey v2's documentation (the @see address).
;
; Tags beyond the usual @param, @returns and @example:
;   @group       the heading the function is listed under (one of the groups in reference.ts)
;   @powershell  what the PowerShell version uses in its place, from powershell/docs/ahk-builtins.md
;   @see         the function's page in AutoHotkey's documentation
;
; A parameter written Name? or Name* can be left out; Name := value gives what it is when left out.
;
; Licence: GPL version 3, like the rest of the project.

; ************************* Keys and mouse *************************

/**
 * Presses keys and types text in the active window, as if they were typed on the keyboard. Most characters are typed as they are; a few symbols hold down Ctrl, Alt, Shift or Win for the next key, and braces name keys that are not characters. Send "^c" and Send("^c") are the same call. Windows does not let any program send Ctrl+Alt+Del, and keys may not reach a program that runs as administrator when the macropad does not.
 * @param {String} Keys - What to press, in quotes. ^ before a key holds Ctrl for it, ! holds Alt, + holds Shift and # holds the Windows key; they act on the next key only and can be combined, so "^+t" is Ctrl+Shift+T. A capital letter is typed with Shift, so "!A" is Alt+Shift+A: write letters in lower case after a symbol. < and > are no symbols here and are typed as they are; for only the left or right Ctrl, Alt, Shift or Win, name it in braces: {LCtrl}, {RCtrl}, {LAlt}, {RAlt}, {LShift}, {RShift}, {LWin}, {RWin}. A key name goes in braces: {Enter}, {Tab}, {Esc}, {Space}, {Backspace}, {Delete}, {Insert}, {Home}, {End}, {PgUp}, {PgDn}, {Up}, {Down}, {Left}, {Right}, {F1} to {F24}, {Ctrl}, {Alt}, {Shift}, {AppsKey}, {PrintScreen}, {CapsLock}, {Numpad0} to {Numpad9}, {Volume_Up}, {Volume_Down}, {Volume_Mute}, {Media_Play_Pause}, {Media_Next}, {Browser_Back}. A number after the name presses the key that many times: {Left 3}. Down or up after the name only presses or only lets go of the key, to hold it while others are pressed: {Shift down}...{Shift up}. To type ^ ! + # { or } themselves, put one in braces: {!}, {#}, {{}, {}}. {Raw} types everything after it as written, symbols included. {Text} does the same, sends each character as a character rather than as a key, and sends a new line as Enter: the safest way to type text. {Click} clicks the left mouse button where the pointer is.
 * @example Send "^c"  ; Ctrl+C: copy
 * @example Send "Kind regards,{Enter}Sam"
 * @example Send "#{Left}"  ; Win+Left: the window takes the left half of the screen
 * @example Send "{Left 3}+{Home}"  ; three to the left, then Shift+Home
 * @example Send "{LCtrl down}{Click}{LCtrl up}"  ; a click with the left Ctrl held
 * @example Send "{Text}Price: 5 + 3 = 8 {net}"
 * @example Send "{Raw}^_^"
 * @example Send "{Media_Play_Pause}"
 * @group Keys and mouse
 * @powershell Send-Ahk
 * @see https://www.autohotkey.com/docs/v2/lib/Send.htm
 */
Send(Keys) {
}

/**
 * Types text exactly as written: ^ ! + # { and } are typed like any other character, and nothing in braces is read as a key name. A new line (`n) is sent as Enter and a tab (`t) as Tab.
 * @param {String} Keys - The text to type, in quotes.
 * @example SendText "me@example.com"
 * @example SendText "Total: 5 + 3 = 8 {done}"
 * @group Keys and mouse
 * @powershell Send-Text
 * @see https://www.autohotkey.com/docs/v2/lib/Send.htm#SendText
 */
SendText(Keys) {
}

/**
 * Sends keys like Send, always by Windows' fast SendInput method, whatever SendMode is set to. Keys typed on the real keyboard meanwhile wait until it is done. Send already works this way unless SendMode was changed.
 * @param {String} Keys - What to press, written as for Send: "^v", "{Enter}", "Hello{Tab}World".
 * @example SendInput "^v"
 * @group Keys and mouse
 * @powershell Send-Ahk
 * @see https://www.autohotkey.com/docs/v2/lib/Send.htm#SendInput
 */
SendInput(Keys) {
}

/**
 * Sends keys like Send, but one at a time, with the pause between keys that SetKeyDelay sets (10 milliseconds unless changed). Slower than Send; for a program that needs time between keys.
 * @param {String} Keys - What to press, written as for Send.
 * @example SetKeyDelay 50
 * SendEvent "abc"
 * @group Keys and mouse
 * @powershell Send-Ahk
 * @see https://www.autohotkey.com/docs/v2/lib/Send.htm#SendEvent
 */
SendEvent(Keys) {
}

/**
 * Chooses how Send, SendText, Click and MouseMove send their keys and clicks from here on. It lasts until the command ends: the next key press of the macropad starts again from the default, Input.
 * @param {String} Mode - "Input" (the default: fast, all at once), "Event" (one key at a time, with the pauses SetKeyDelay sets, as SendEvent does), "InputThenPlay", or "Play" (deprecated: it may do nothing at all on Windows 11).
 * @returns {String} The mode before the call.
 * @example SendMode "Event"
 * @group Keys and mouse
 * @see https://www.autohotkey.com/docs/v2/lib/SendMode.htm
 */
SendMode(Mode) {
}

/**
 * Sets the pause after each key that SendEvent and ControlSend send, and how long each key is held down. Send and SendInput ignore it. It lasts until the command ends.
 * @param {Integer} Delay - Milliseconds to wait after each key: -1 for no wait at all, 0 for the shortest. Left out, it stays as it is (10 unless changed).
 * @param {Integer} PressDuration - Milliseconds each key is held down: -1 (the default) for no wait. Left out, it stays as it is.
 * @param {String} Play - The word "Play" to set the delays of SendPlay instead. Usually left out.
 * @example SetKeyDelay 75, 25
 * @group Keys and mouse
 * @see https://www.autohotkey.com/docs/v2/lib/SetKeyDelay.htm
 */
SetKeyDelay(Delay?, PressDuration?, Play?) {
}

/**
 * Tells whether a key or mouse button is held down, or whether CapsLock, NumLock or ScrollLock is switched on.
 * @param {String} KeyName - The key: a character such as "a" or "5", or a name such as "Shift", "LCtrl", "Enter", "Space", "CapsLock", "LButton" (the left mouse button) or "RButton".
 * @param {String} Mode - Left out, whether Windows takes the key to be down. "P" for whether it is physically held down. "T" for whether CapsLock, NumLock, ScrollLock or Insert is switched on.
 * @returns {Integer} 1 (true) when the key is down or switched on, 0 (false) when it is not.
 * @example if GetKeyState("Shift")
 *     Send "{Home}"
 * @example if GetKeyState("CapsLock", "T")
 *     SetCapsLockState "Off"
 * @group Keys and mouse
 * @powershell Test-KeyPressed, Test-KeyToggled
 * @see https://www.autohotkey.com/docs/v2/lib/GetKeyState.htm
 */
GetKeyState(KeyName, Mode?) {
}

/**
 * Gives the name AutoHotkey uses for a key, from a character, a name or a key code. Handy to turn a code such as "vk0D" into a name you can read.
 * @param {String} KeyName - A character such as "a", a key name such as "Esc", or a key code: "vk" and a hexadecimal number such as "vk0D", or "sc" and a scan code such as "sc01C".
 * @returns {String} The key's name, such as "Enter"; empty when there is no such key.
 * @example name := GetKeyName("vk0D")  ; "Enter"
 * @group Keys and mouse
 * @see https://www.autohotkey.com/docs/v2/lib/GetKeyName.htm
 */
GetKeyName(KeyName) {
}

/**
 * Switches CapsLock on or off, or keeps it on or off whatever is pressed.
 * @param {String} State - "On" or "Off" switches it; "AlwaysOn" or "AlwaysOff" keeps it so until it is set again. Left out, an AlwaysOn or AlwaysOff is lifted and the state stays as it is.
 * @example SetCapsLockState "Off"
 * @group Keys and mouse
 * @powershell Set-LockKeyState
 * @see https://www.autohotkey.com/docs/v2/lib/SetNumScrollCapsLockState.htm
 */
SetCapsLockState(State?) {
}

/**
 * Switches NumLock on or off, or keeps it on or off whatever is pressed.
 * @param {String} State - "On" or "Off" switches it; "AlwaysOn" or "AlwaysOff" keeps it so until it is set again. Left out, an AlwaysOn or AlwaysOff is lifted and the state stays as it is.
 * @example SetNumLockState "On"
 * @group Keys and mouse
 * @powershell Set-LockKeyState
 * @see https://www.autohotkey.com/docs/v2/lib/SetNumScrollCapsLockState.htm
 */
SetNumLockState(State?) {
}

/**
 * Switches ScrollLock on or off, or keeps it on or off whatever is pressed.
 * @param {String} State - "On" or "Off" switches it; "AlwaysOn" or "AlwaysOff" keeps it so until it is set again. Left out, an AlwaysOn or AlwaysOff is lifted and the state stays as it is.
 * @example SetScrollLockState "Off"
 * @group Keys and mouse
 * @powershell Set-LockKeyState
 * @see https://www.autohotkey.com/docs/v2/lib/SetNumScrollCapsLockState.htm
 */
SetScrollLockState(State?) {
}

/**
 * Clicks a mouse button, or turns the wheel: where the pointer is, or at a point it moves to first. With nothing given, it clicks the left button once where the pointer is. Points count from the top left corner of the inside of the active window, unless CoordMode "Mouse", "Screen" was called first.
 * @param {String} Options - What to do, in any order, in one string or as separate values: the X and Y of the point; the button, "Left", "Right", "Middle", "X1" or "X2", or "WheelUp" or "WheelDown" for the wheel; how many clicks (or wheel notches), 0 to only move the pointer; "Down" or "Up" to only press or only let go of the button; "Rel" to read X and Y as a distance from where the pointer is.
 * @example Click  ; the left button, where the pointer is
 * @example Click 200, 300  ; at that point
 * @example Click 200, 300, "Right"
 * @example Click 2  ; a double click where the pointer is
 * @example Click "WheelDown 3"
 * @group Keys and mouse
 * @powershell Send-Click
 * @see https://www.autohotkey.com/docs/v2/lib/Click.htm
 */
Click(Options*) {
}

/**
 * Moves the mouse pointer to a point. Points count from the top left corner of the inside of the active window, unless CoordMode "Mouse", "Screen" was called first.
 * @param {Integer} X - Pixels from the left.
 * @param {Integer} Y - Pixels from the top.
 * @param {Integer} Speed - From 0 (at once) to 100 (slowest); left out, 2. Send's default way of sending moves at once whatever this says.
 * @param {String} Relative - "R" to move by X and Y from where the pointer is, instead of to a point.
 * @example MouseMove 500, 400
 * @example MouseMove 0, -50, 0, "R"  ; 50 pixels up from where it is
 * @group Keys and mouse
 * @powershell Move-Mouse
 * @see https://www.autohotkey.com/docs/v2/lib/MouseMove.htm
 */
MouseMove(X, Y, Speed?, Relative?) {
}

/**
 * Finds where the mouse pointer is, and which window and control are under it. Each value goes into a variable you name with & in front; leave out the ones you do not need, keeping their commas. Points count from the top left corner of the inside of the active window, unless CoordMode "Mouse", "Screen" was called first.
 * @param {VarRef} OutputVarX - The variable that gets the pointer's X, such as &x.
 * @param {VarRef} OutputVarY - The variable that gets the pointer's Y, such as &y.
 * @param {VarRef} OutputVarWin - The variable that gets the handle of the window under the pointer: a number that names that one window, which any WinTitle accepts.
 * @param {VarRef} OutputVarControl - The variable that gets the name (ClassNN, such as "Edit1") of the control under the pointer: a button, a text box or another part of the window.
 * @param {Integer} Flag - Left out, 0. 2 puts the control's handle in OutputVarControl instead of its name; 1 and 3 change how the control is found. Usually left out.
 * @example MouseGetPos &x, &y
 * ToolTip "The pointer is at " x ", " y
 * @example MouseGetPos , , &win
 * WinClose win
 * @group Keys and mouse
 * @powershell Get-MousePosition
 * @see https://www.autohotkey.com/docs/v2/lib/MouseGetPos.htm
 */
MouseGetPos(&OutputVarX?, &OutputVarY?, &OutputVarWin?, &OutputVarControl?, Flag?) {
}

/**
 * Chooses what the X and Y of later mouse, pixel and tooltip functions count from: the whole screen, the active window, or the inside of the active window (the default). It lasts until the command ends.
 * @param {String} TargetType - What it is for: "Mouse" (Click, MouseMove, MouseGetPos), "Pixel" (PixelGetColor, PixelSearch, ImageSearch), "ToolTip", "Caret" or "Menu".
 * @param {String} RelativeTo - "Screen" (the whole screen, from its top left corner), "Window" (the active window, title bar included) or "Client" (the inside of the active window, which each command starts with). Left out, "Screen".
 * @returns {String} The setting before the call.
 * @example CoordMode "Mouse", "Screen"
 * Click 10, 10  ; near the top left corner of the screen
 * @group Keys and mouse
 * @powershell ConvertTo-ScreenPoint
 * @see https://www.autohotkey.com/docs/v2/lib/CoordMode.htm
 */
CoordMode(TargetType, RelativeTo?) {
}

/**
 * Makes an object that collects what is typed on the keyboard, such as one key or a word ending in Enter. Call its Start method to begin and its Wait method to wait for the end; then its Input property holds what was typed and its EndKey which key ended it.
 * @param {String} Options - Letters that set how it collects, in any order: "L" and a number stops after that many characters ("L1" for one key); "T" and a number stops after that many seconds; "V" lets the keys reach the active window too, which otherwise does not see them.
 * @param {String} EndKeys - Keys that end the input, written as for Send: "{Enter}{Esc}".
 * @param {String} MatchList - Words, separated by commas, that end the input as soon as one is typed.
 * @returns {InputHook} The object, with Start, Wait and Stop methods and Input, EndKey and EndReason properties.
 * @example ih := InputHook("L1 T5")  ; one key, at most 5 seconds
 * ih.Start()
 * ih.Wait()
 * MsgBox "You pressed " ih.Input
 * @group Keys and mouse
 * @see https://www.autohotkey.com/docs/v2/lib/InputHook.htm
 */
InputHook(Options?, EndKeys?, MatchList?) {
}

; ************************* Windows *************************

/**
 * Tells whether a window exists, and finds it. The window it finds becomes the last found window, which later Win functions use when their WinTitle is left out. Hidden windows are skipped.
 * @param {String} WinTitle - Which window: part of its title such as "Notepad", or "ahk_exe notepad.exe" for any window of that program, "ahk_class " and a class name for one kind of window, or a window handle (the number this function returns). Several can be combined: "Untitled ahk_exe notepad.exe". Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, such as a button's caption, as Window Spy (which comes with AutoHotkey) lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The window's handle, a number that names that one window; 0 (false) when there is none, so it works in an if.
 * @example if WinExist("ahk_exe notepad.exe")
 *     WinActivate  ; the window WinExist found
 * else
 *     Run "notepad.exe"
 * @group Windows
 * @powershell Find-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinExist.htm
 */
WinExist(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Tells whether the active window (the one keys go to) is the one described.
 * @param {String} WinTitle - Which window: part of its title such as "Notepad", or "ahk_exe notepad.exe" for any window of that program, "ahk_class " and a class name for one kind of window, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The active window's handle when it matches; 0 (false) when it does not.
 * @example if WinActive("ahk_exe chrome.exe")
 *     Send "^t"  ; a new tab, only in Chrome
 * @group Windows
 * @powershell Test-WindowActive
 * @see https://www.autohotkey.com/docs/v2/lib/WinActive.htm
 */
WinActive(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Brings a window to the front and makes it active, so keys go to it. A minimized window is restored first. Stops the command with an error when there is no such window: check with WinExist first.
 * @param {String} WinTitle - Which window: part of its title such as "Notepad", or "ahk_exe notepad.exe" for any window of that program, "ahk_class " and a class name for one kind of window, or a window handle. Left out, the last found window: the one the last WinExist or WinWait found.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinActivate "ahk_exe notepad.exe"
 * @group Windows
 * @powershell Switch-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinActivate.htm
 */
WinActivate(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Activates the matching window that was used longest ago (the bottom one) instead of the most recent. Called again and again, it steps through every window of a program. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which windows: part of their title, or "ahk_exe chrome.exe" for every window of that program, or "ahk_class " and a class name. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinActivateBottom "ahk_exe explorer.exe"
 * @group Windows
 * @powershell Switch-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinActivateBottom.htm
 */
WinActivateBottom(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Lists every window that matches, newest first, as an array of window handles to go through with a for loop.
 * @param {String} WinTitle - Which windows: part of their title, "ahk_exe notepad.exe" for every window of that program, or "ahk_class " and a class name. Left out, with the others left out too, every window there is.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Array} The handles of the windows; empty when none matches.
 * @example for hwnd in WinGetList("ahk_exe notepad.exe")
 *     WinMinimize hwnd
 * @group Windows
 * @powershell Find-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetList.htm
 */
WinGetList(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives a window's title, the text in its title bar.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {String} The title.
 * @example title := WinGetTitle("A")
 * @group Windows
 * @powershell Get-WindowInfo
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetTitle.htm
 */
WinGetTitle(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives a window's class: the name of its kind, which stays the same while the title changes. Use it as "ahk_class " class in a WinTitle.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {String} The class name, such as "Notepad" or "CabinetWClass".
 * @example class := WinGetClass("A")
 * @group Windows
 * @powershell Get-WindowInfo
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetClass.htm
 */
WinGetClass(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives a window's handle: a number that names that one window for as long as it is open, which any WinTitle accepts.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, or "ahk_exe notepad.exe" for a window of that program. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The handle.
 * @example hwnd := WinGetID("A")
 * ; ... later, the same window, whatever is active by then:
 * WinActivate hwnd
 * @group Windows
 * @powershell Get-WindowInfo
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetID.htm
 */
WinGetID(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives the process ID of the program a window belongs to: the number Windows gives each running program, which ProcessClose and "ahk_pid " in a WinTitle take.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The process ID.
 * @example pid := WinGetPID("A")
 * @group Windows
 * @powershell Get-WindowInfo
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetPID.htm
 */
WinGetPID(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives the file name of the program a window belongs to, such as "chrome.exe": what goes after "ahk_exe " in a WinTitle.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {String} The program's file name, without its folder.
 * @example if WinGetProcessName("A") = "code.exe"
 *     Send "^s"
 * @group Windows
 * @powershell Get-WindowInfo
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetProcessName.htm
 */
WinGetProcessName(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives the full path of the program a window belongs to, such as "C:\Windows\System32\notepad.exe".
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {String} The program's path.
 * @example path := WinGetProcessPath("A")
 * @group Windows
 * @powershell Get-WindowInfo
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetProcessPath.htm
 */
WinGetProcessPath(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Asks a window to close, as its X button does. The program may ask first whether to save. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {Number} SecondsToWait - How long to wait for the window to close, in seconds. Left out, it does not wait.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinClose "A"
 * @group Windows
 * @powershell Close-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinClose.htm
 */
WinClose(WinTitle?, WinText?, SecondsToWait?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Closes a window by force: it first asks it to close, and if that fails ends its program. Anything unsaved is lost. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {Number} SecondsToWait - How long to wait for the window to close, in seconds. Left out, it does not wait.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinKill "ahk_exe notepad.exe"
 * @group Windows
 * @powershell Close-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinKill.htm
 */
WinKill(WinTitle?, WinText?, SecondsToWait?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Minimizes a window to the taskbar. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinMinimize "A"
 * @group Windows
 * @powershell Set-WindowState
 * @see https://www.autohotkey.com/docs/v2/lib/WinMinimize.htm
 */
WinMinimize(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Maximizes a window so that it fills the screen. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinMaximize "A"
 * @group Windows
 * @powershell Set-WindowState
 * @see https://www.autohotkey.com/docs/v2/lib/WinMaximize.htm
 */
WinMaximize(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Brings a minimized or maximized window back to its normal size and place. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinRestore "A"
 * @group Windows
 * @powershell Set-WindowState
 * @see https://www.autohotkey.com/docs/v2/lib/WinRestore.htm
 */
WinRestore(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Hides a window: it leaves the screen and the taskbar, but its program keeps running. WinShow brings it back. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Keep the handle (WinGetID) to find the window again once it is hidden. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinHide "ahk_exe notepad.exe"
 * @group Windows
 * @powershell Set-WindowState
 * @see https://www.autohotkey.com/docs/v2/lib/WinHide.htm
 */
WinHide(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Shows a window that WinHide hid. Unlike the other Win functions, it finds hidden windows. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which window: part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinShow "ahk_exe notepad.exe"
 * @group Windows
 * @powershell Set-WindowState
 * @see https://www.autohotkey.com/docs/v2/lib/WinShow.htm
 */
WinShow(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Tells whether a window is minimized, maximized or neither. Stops the command with an error when there is no such window.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} -1 when minimized, 1 when maximized, 0 when neither.
 * @example if WinGetMinMax("A") = 1
 *     WinRestore "A"
 * else
 *     WinMaximize "A"
 * @group Windows
 * @powershell Get-WindowState
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetMinMax.htm
 */
WinGetMinMax(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Moves a window, or changes its size, or both. X and Y count from the top left corner of the screen. Stops the command with an error when there is no such window.
 * @param {Integer} X - Pixels from the left edge of the screen to the window's left edge. Left out, it stays.
 * @param {Integer} Y - Pixels from the top of the screen to the window's top. Left out, it stays.
 * @param {Integer} Width - The new width in pixels. Left out, it stays.
 * @param {Integer} Height - The new height in pixels. Left out, it stays.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinMove 0, 0, 800, 600, "A"
 * @example WinMove , , 1280, 720, "A"  ; only the size
 * @group Windows
 * @powershell Move-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinMove.htm
 */
WinMove(X?, Y?, Width?, Height?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Finds where a window is on the screen and how big it is, title bar and borders included. Each value goes into a variable you name with & in front; leave out the ones you do not need, keeping their commas.
 * @param {VarRef} OutX - The variable that gets the X of the window's left edge, from the left of the screen.
 * @param {VarRef} OutY - The variable that gets the Y of the window's top, from the top of the screen.
 * @param {VarRef} OutWidth - The variable that gets its width in pixels.
 * @param {VarRef} OutHeight - The variable that gets its height in pixels.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinGetPos &x, &y, &w, &h, "A"
 * MsgBox "The window is " w " by " h " pixels."
 * @group Windows
 * @powershell Get-WindowRect
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetPos.htm
 */
WinGetPos(&OutX?, &OutY?, &OutWidth?, &OutHeight?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Finds where the inside of a window is on the screen and how big it is: the part below the title bar and menu, within the borders. Each value goes into a variable you name with & in front.
 * @param {VarRef} OutX - The variable that gets the X of the inside's left edge, from the left of the screen.
 * @param {VarRef} OutY - The variable that gets the Y of the inside's top, from the top of the screen.
 * @param {VarRef} OutWidth - The variable that gets its width in pixels.
 * @param {VarRef} OutHeight - The variable that gets its height in pixels.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinGetClientPos &x, &y, &w, &h, "A"
 * @group Windows
 * @powershell Get-WindowRect
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetClientPos.htm
 */
WinGetClientPos(&OutX?, &OutY?, &OutWidth?, &OutHeight?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Keeps a window above all others, even when another is active; or stops doing so.
 * @param {Integer} NewSetting - 1 to keep it on top, 0 to stop, -1 to switch between the two. Left out, 1.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinSetAlwaysOnTop -1, "A"  ; on, or off when it was on
 * @group Windows
 * @powershell Set-WindowTopmost
 * @see https://www.autohotkey.com/docs/v2/lib/WinSetAlwaysOnTop.htm
 */
WinSetAlwaysOnTop(NewSetting?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Makes a whole window see-through, so what is behind it shows.
 * @param {Integer} N - How solid it is, from 0 (invisible) to 255 (not see-through at all); "Off" turns it off.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinSetTransparent 180, "A"
 * @example WinSetTransparent "Off", "A"
 * @group Windows
 * @powershell Set-WindowTransparency
 * @see https://www.autohotkey.com/docs/v2/lib/WinSetTransparent.htm
 */
WinSetTransparent(N, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Makes every pixel of one colour in a window invisible, so what is behind shows through there, and a click there goes to the window behind.
 * @param {String} Color - The colour: a name such as "White", or a number in red-green-blue form such as 0xFFFFFF. A space and a number from 0 to 255 after it also makes the rest of the window see-through: "White 150". "Off" turns it off.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinSetTransColor "White", "A"
 * @group Windows
 * @powershell Set-WindowTransparency
 * @see https://www.autohotkey.com/docs/v2/lib/WinSetTransColor.htm
 */
WinSetTransColor(Color?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives a window's style: a number whose bits say how it looks and behaves (a title bar, borders, whether it can be resized). Windows' documentation lists the bits.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The style.
 * @example if WinGetStyle("A") & 0x40000  ; WS_SIZEBOX
 *     MsgBox "The window can be resized."
 * @group Windows
 * @powershell Get-WindowStyle
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetStyle.htm
 */
WinGetStyle(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives a window's extended style: a second number of bits, such as whether it stays on top (0x8).
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The extended style.
 * @example if WinGetExStyle("A") & 0x8  ; WS_EX_TOPMOST
 *     MsgBox "The window stays on top."
 * @group Windows
 * @powershell Get-WindowStyle
 * @see https://www.autohotkey.com/docs/v2/lib/WinGetStyle.htm
 */
WinGetExStyle(WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Changes a window's style bits, such as taking away its title bar. Windows' documentation lists the bits.
 * @param {String} Value - The bits: "+" and a number adds them, "-" takes them away, "^" switches them; a number alone replaces the whole style.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinSetStyle "^0xC00000", "A"  ; WS_CAPTION: the title bar off, or on again
 * @group Windows
 * @powershell Set-WindowStyle
 * @see https://www.autohotkey.com/docs/v2/lib/WinSetStyle.htm
 */
WinSetStyle(Value, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Changes a window's extended style bits, such as letting clicks pass through it.
 * @param {String} Value - The bits: "+" and a number adds them, "-" takes them away, "^" switches them; a number alone replaces the whole extended style.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example WinSetExStyle "^0x20", "A"  ; WS_EX_TRANSPARENT: clicks pass through, or no longer do
 * @group Windows
 * @powershell Set-WindowStyle
 * @see https://www.autohotkey.com/docs/v2/lib/WinSetStyle.htm
 */
WinSetExStyle(Value, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Chooses how the text of a WinTitle is matched against window titles from here on. It lasts until the command ends.
 * @param {String} MatchMode - 1: the title must start with it. 2 (the default): it may be anywhere in the title. 3: the title must be exactly it. "RegEx": it is a regular expression. Instead of these, "Fast" (the default) or "Slow" chooses how WinText is matched: Slow also finds text in some controls that Fast misses.
 * @returns {String} The setting before the call.
 * @example SetTitleMatchMode 1
 * WinActivate "Untitled"  ; only a title that starts with Untitled
 * @group Windows
 * @see https://www.autohotkey.com/docs/v2/lib/SetTitleMatchMode.htm
 */
SetTitleMatchMode(MatchMode) {
}

/**
 * Adds windows to a named group, so that one WinTitle, "ahk_group " and the name, matches any of them. Call it once for each kind of window.
 * @param {String} GroupName - The group's name, made up by you. The group is made the first time.
 * @param {String} WinTitle - Which windows: part of their title, "ahk_exe notepad.exe" for every window of that program, or "ahk_class " and a class name.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example GroupAdd "Browsers", "ahk_exe chrome.exe"
 * GroupAdd "Browsers", "ahk_exe msedge.exe"
 * if WinActive("ahk_group Browsers")
 *     Send "^t"
 * @group Windows
 * @see https://www.autohotkey.com/docs/v2/lib/GroupAdd.htm
 */
GroupAdd(GroupName, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives the handle of a control: one part of a window, such as a button, a text box or a list. Stops the command with an error when there is no such control.
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1" or "Button2") as Window Spy shows it, its text, or its handle.
 * @param {String} WinTitle - Which window it is in: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The control's handle, which the Control parameter of the other Control functions accepts.
 * @example edit := ControlGetHwnd("Edit1", "ahk_exe notepad.exe")
 * @group Windows
 * @powershell Find-Control
 * @see https://www.autohotkey.com/docs/v2/lib/ControlGetHwnd.htm
 */
ControlGetHwnd(Control, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Reads the text of a control, such as what is typed in a text box. Stops the command with an error when there is no such control.
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle.
 * @param {String} WinTitle - Which window it is in: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {String} The control's text.
 * @example text := ControlGetText("Edit1", "ahk_exe notepad.exe")
 * @group Windows
 * @powershell Get-ControlText
 * @see https://www.autohotkey.com/docs/v2/lib/ControlGetText.htm
 */
ControlGetText(Control, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Replaces the text of a control, such as a text box or a label, without typing it. Stops the command with an error when there is no such control.
 * @param {String} NewText - The text to put there.
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle.
 * @param {String} WinTitle - Which window it is in: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example ControlSetText "Hello", "Edit1", "ahk_exe notepad.exe"
 * @group Windows
 * @powershell Set-ControlText
 * @see https://www.autohotkey.com/docs/v2/lib/ControlSetText.htm
 */
ControlSetText(NewText, Control, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Clicks a control, or a point in a window, without moving the mouse pointer and even when the window is not active. Some programs ignore such clicks. AutoHotkey's own page names the first parameter Control-or-Pos. Stops the command with an error when there is no such window or control.
 * @param {String} ControlOrPos - Which control: its name (ClassNN, such as "Button1") as Window Spy shows it, its text, or its handle; or a point, "x" and "y" with numbers counted from the top left of the window's inside: "x50 y120". Left out, the window itself.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} WhichButton - "Left" (the default), "Right", "Middle", "X1" or "X2"; or "WheelUp" or "WheelDown" to turn the wheel.
 * @param {Integer} ClickCount - How many clicks, or wheel notches. Left out, 1.
 * @param {String} Options - Seldom needed: "D" only presses the button, "U" only lets go of it, "NA" may help when the window is not active, and "Pos" reads the first parameter as a point.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example ControlClick "Button1", "ahk_exe setup.exe"
 * @example ControlClick "x50 y120", "A", , "Right"
 * @group Windows
 * @powershell Invoke-ControlClick
 * @see https://www.autohotkey.com/docs/v2/lib/ControlClick.htm
 */
ControlClick(ControlOrPos?, WinTitle?, WinText?, WhichButton?, ClickCount?, Options?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Sends keys to a window or one of its controls without making it active, so it works on a window in the background. Some programs ignore such keys.
 * @param {String} Keys - What to press, written as for Send: "^s", "Hello{Enter}".
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle. Left out, the window itself.
 * @param {String} WinTitle - Which window: part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example ControlSend "Hello{Enter}", "Edit1", "ahk_exe notepad.exe"
 * @group Windows
 * @powershell Send-ControlKeys
 * @see https://www.autohotkey.com/docs/v2/lib/ControlSend.htm
 */
ControlSend(Keys, Control?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Types text into a window or one of its controls without making it active, every character as written: ^ ! + # { and } are typed like any other.
 * @param {String} Keys - The text to type.
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle. Left out, the window itself.
 * @param {String} WinTitle - Which window: part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example ControlSendText "50% off {today}", "Edit1", "ahk_exe notepad.exe"
 * @group Windows
 * @powershell Send-ControlKeys
 * @see https://www.autohotkey.com/docs/v2/lib/ControlSend.htm
 */
ControlSendText(Keys, Control?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Finds where a control is in its window and how big it is. Each value goes into a variable you name with & in front. X and Y count from the top left corner of the window's inside.
 * @param {VarRef} OutX - The variable that gets the X of the control's left edge.
 * @param {VarRef} OutY - The variable that gets the Y of the control's top.
 * @param {VarRef} OutWidth - The variable that gets its width in pixels.
 * @param {VarRef} OutHeight - The variable that gets its height in pixels.
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle.
 * @param {String} WinTitle - Which window it is in: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example ControlGetPos &x, &y, &w, &h, "Edit1", "ahk_exe notepad.exe"
 * @group Windows
 * @powershell Get-WindowRect
 * @see https://www.autohotkey.com/docs/v2/lib/ControlGetPos.htm
 */
ControlGetPos(&OutX?, &OutY?, &OutWidth?, &OutHeight?, Control, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives a control's style: a number whose bits say how it looks and behaves. Windows' documentation lists the bits for each kind of control.
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle.
 * @param {String} WinTitle - Which window it is in: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The style.
 * @example if ControlGetStyle("Edit1", "A") & 0x800  ; ES_READONLY
 *     MsgBox "The text box is read-only."
 * @group Windows
 * @powershell Get-WindowStyle
 * @see https://www.autohotkey.com/docs/v2/lib/ControlGetStyle.htm
 */
ControlGetStyle(Control, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Gives a control's extended style: a second number of bits, such as whether it has a sunken border (0x200).
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle.
 * @param {String} WinTitle - Which window it is in: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The extended style.
 * @example exStyle := ControlGetExStyle("Edit1", "A")
 * @group Windows
 * @powershell Get-WindowStyle
 * @see https://www.autohotkey.com/docs/v2/lib/ControlGetStyle.htm
 */
ControlGetExStyle(Control, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Changes a control's style bits, such as giving it a border. Windows' documentation lists the bits for each kind of control.
 * @param {String} Value - The bits: "+" and a number adds them, "-" takes them away, "^" switches them; a number alone replaces the whole style.
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle.
 * @param {String} WinTitle - Which window it is in: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example ControlSetStyle "^0x800000", "Edit1", "A"  ; WS_BORDER: a border on, or off again
 * @group Windows
 * @powershell Set-WindowStyle
 * @see https://www.autohotkey.com/docs/v2/lib/ControlSetStyle.htm
 */
ControlSetStyle(Value, Control, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Changes a control's extended style bits, such as giving it a sunken border.
 * @param {String} Value - The bits: "+" and a number adds them, "-" takes them away, "^" switches them; a number alone replaces the whole extended style.
 * @param {String} Control - Which control: its name (ClassNN, such as "Edit1") as Window Spy shows it, its text, or its handle.
 * @param {String} WinTitle - Which window it is in: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example ControlSetExStyle "^0x200", "Edit1", "A"  ; WS_EX_CLIENTEDGE: a sunken border on, or off again
 * @group Windows
 * @powershell Set-WindowStyle
 * @see https://www.autohotkey.com/docs/v2/lib/ControlSetStyle.htm
 */
ControlSetExStyle(Value, Control, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Sends a Windows message to a window or a control and waits for it to be handled. Messages are numbers listed in Windows' documentation; this is for what no other function does, such as turning the monitors off.
 * @param {Integer} MsgNumber - The message, such as 0x112 (WM_SYSCOMMAND).
 * @param {Integer} wParam - The message's first value. Left out, 0.
 * @param {Integer} lParam - The message's second value. Left out, 0.
 * @param {String} Control - Which control to send it to: its name (ClassNN), its text, or its handle. Left out, the window itself.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @param {Integer} Timeout - The longest wait for an answer, in milliseconds; past it, the command stops with an error. Left out, 5000; 0 waits for ever.
 * @returns {Integer} The window's answer; what it means depends on the message.
 * @example SendMessage 0x112, 0xF170, 2, , "Program Manager"  ; turns the monitors off
 * @group Windows
 * @powershell Send-WindowMessage
 * @see https://www.autohotkey.com/docs/v2/lib/SendMessage.htm
 */
SendMessage(MsgNumber, wParam?, lParam?, Control?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?, Timeout?) {
}

/**
 * Puts a Windows message in a window's queue and goes on at once, without waiting for it to be handled. Messages are numbers listed in Windows' documentation.
 * @param {Integer} MsgNumber - The message, such as 0x112 (WM_SYSCOMMAND).
 * @param {Integer} wParam - The message's first value. Left out, 0.
 * @param {Integer} lParam - The message's second value. Left out, 0.
 * @param {String} Control - Which control to post it to: its name (ClassNN), its text, or its handle. Left out, the window itself.
 * @param {String} WinTitle - Which window: "A" for the active window, part of its title, "ahk_exe notepad.exe" for a window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @example PostMessage 0x112, 0xF020, , , "A"  ; SC_MINIMIZE: minimizes the active window
 * @group Windows
 * @powershell Send-WindowMessage
 * @see https://www.autohotkey.com/docs/v2/lib/PostMessage.htm
 */
PostMessage(MsgNumber, wParam?, lParam?, Control?, WinTitle?, WinText?, ExcludeTitle?, ExcludeText?) {
}

; ************************* Programs and files *************************

/**
 * Starts a program, or opens a file, a folder or a web address with the program Windows uses for it, and goes on at once without waiting. Stops the command with an error when it cannot be started.
 * @param {String} Target - What to start: a program such as "notepad.exe", a file or folder such as "C:\Users", or a web address. Arguments for the program follow its name. A path with spaces goes in double quotes inside the string: '"C:\Program Files\App\app.exe" --new-window'.
 * @param {String} WorkingDir - The folder the program starts in. Left out, the macropad's own working folder.
 * @param {String} Options - "Max" to start it maximized, "Min" minimized, "Hide" hidden.
 * @param {VarRef} OutputVarPID - The variable that gets the new program's process ID, such as &pid: the number Windows gives each running program.
 * @example Run "notepad.exe"
 * @example Run "https://www.autohotkey.com/docs/v2/"
 * @example Run '"C:\Program Files\Mozilla Firefox\firefox.exe" --private-window'
 * @example Run "explorer.exe C:\Users"
 * @group Programs and files
 * @powershell Start-Process
 * @see https://www.autohotkey.com/docs/v2/lib/Run.htm
 */
Run(Target, WorkingDir?, Options?, &OutputVarPID?) {
}

/**
 * Starts a program like Run, then waits until it closes before the command goes on.
 * @param {String} Target - What to start: a program such as "notepad.exe", a file, a folder or a web address, with any arguments after the program's name. A path with spaces goes in double quotes inside the string.
 * @param {String} WorkingDir - The folder the program starts in. Left out, the macropad's own working folder.
 * @param {String} Options - "Max" to start it maximized, "Min" minimized, "Hide" hidden.
 * @param {VarRef} OutputVarPID - The variable that gets the new program's process ID, such as &pid.
 * @returns {Integer} The program's exit code: the number it ends with, usually 0 when all went well.
 * @example code := RunWait('cmd.exe /c "ipconfig /flushdns"', , "Hide")
 * @group Programs and files
 * @powershell Start-Process
 * @see https://www.autohotkey.com/docs/v2/lib/Run.htm
 */
RunWait(Target, WorkingDir?, Options?, &OutputVarPID?) {
}

/**
 * Tells whether a program is running.
 * @param {String} PIDOrName - The program's file name, such as "notepad.exe", or its process ID (the number Windows gives each running program). Left out, the macropad's own.
 * @returns {Integer} The program's process ID; 0 (false) when it is not running.
 * @example if !ProcessExist("notepad.exe")
 *     Run "notepad.exe"
 * @group Programs and files
 * @powershell Get-Process
 * @see https://www.autohotkey.com/docs/v2/lib/ProcessExist.htm
 */
ProcessExist(PIDOrName?) {
}

/**
 * Ends a running program at once, by force. Anything unsaved in it is lost; WinClose asks it nicely instead.
 * @param {String} PIDOrName - The program's file name, such as "notepad.exe" (the first one found, when several run), or its process ID.
 * @returns {Integer} The process ID of the program it ended; 0 when none was found or it could not be ended.
 * @example ProcessClose "notepad.exe"
 * @group Programs and files
 * @powershell Stop-Process
 * @see https://www.autohotkey.com/docs/v2/lib/ProcessClose.htm
 */
ProcessClose(PIDOrName) {
}

/**
 * Logs off, shuts down or restarts the computer. A function of the scripts with the same name is called in its place: the shared commands define one (ahk/commands/power.ahk), and while they do, Shutdown runs that command instead.
 * @param {Integer} Flag - What to do, as a sum: 0 logs off, 1 shuts down, 2 restarts, 8 shuts down and powers off; add 4 to force programs to close, losing anything unsaved. 9 (1 + 8) shuts down and switches the computer off.
 * @example Shutdown 2  ; restart
 * @group Programs and files
 * @powershell shutdown.exe
 * @see https://www.autohotkey.com/docs/v2/lib/Shutdown.htm
 */
Shutdown(Flag) {
}

/**
 * Tells whether a file or folder exists.
 * @param {String} FilePattern - The path of the file or folder, such as "C:\Notes\todo.txt". It may hold * and ? as wildcards: "C:\Notes\*.txt". A path without a drive counts from the macropad's working folder.
 * @returns {String} Letters for the attributes of the first match, such as "A" or "D" (a folder); empty (false) when there is none, so it works in an if.
 * @example if FileExist("C:\Notes\todo.txt")
 *     Run "C:\Notes\todo.txt"
 * @group Programs and files
 * @powershell Test-Path
 * @see https://www.autohotkey.com/docs/v2/lib/FileExist.htm
 */
FileExist(FilePattern) {
}

/**
 * Tells whether a folder exists; a file of that name does not count.
 * @param {String} FilePattern - The path of the folder, such as "C:\Projects". It may hold * and ? as wildcards.
 * @returns {String} Letters for the folder's attributes, such as "D"; empty (false) when there is no such folder.
 * @example if !DirExist("C:\Backup")
 *     DirCreate "C:\Backup"
 * @group Programs and files
 * @powershell Test-Path
 * @see https://www.autohotkey.com/docs/v2/lib/DirExist.htm
 */
DirExist(FilePattern) {
}

/**
 * Reads a whole text file. Stops the command with an error when the file cannot be read.
 * @param {String} Filename - The file's path. A path without a drive counts from the macropad's working folder.
 * @param {String} Options - Seldom needed: an encoding such as "UTF-8"; "`n" to turn each Windows line ending into a plain new line; "m" and a number to read only that many bytes.
 * @returns {String} The file's text.
 * @example text := FileRead("C:\Notes\todo.txt")
 * @group Programs and files
 * @powershell Get-Content
 * @see https://www.autohotkey.com/docs/v2/lib/FileRead.htm
 */
FileRead(Filename, Options?) {
}

/**
 * Adds text to the end of a file, making the file when it does not exist yet. Stops the command with an error when the file cannot be written.
 * @param {String} Text - The text to add. "`n" in it starts a new line.
 * @param {String} Filename - The file's path. A path without a drive counts from the macropad's working folder.
 * @param {String} Options - Seldom needed: an encoding such as "UTF-8"; "`n" to write each new line as a Windows line ending.
 * @example FileAppend FormatTime(, "yyyy-MM-dd HH:mm") " pressed`n", "C:\Notes\log.txt"
 * @group Programs and files
 * @powershell Add-Content
 * @see https://www.autohotkey.com/docs/v2/lib/FileAppend.htm
 */
FileAppend(Text, Filename?, Options?) {
}

/**
 * Reads a value from an .ini file: a text file of [Section] headings with Key=Value lines under them.
 * @param {String} Filename - The .ini file's path.
 * @param {String} Section - The section's name, without its brackets. Left out, the names of every section, one per line.
 * @param {String} Key - The key's name. Left out, the whole section.
 * @param {String} Default - What to give when the file, section or key is not there. Left out, a missing one stops the command with an error.
 * @returns {String} The value.
 * @example volume := IniRead("C:\Notes\settings.ini", "Sound", "Volume", 50)
 * @group Programs and files
 * @see https://www.autohotkey.com/docs/v2/lib/IniRead.htm
 */
IniRead(Filename, Section?, Key?, Default?) {
}

/**
 * Writes a value to an .ini file, making the file, section or key when it is not there.
 * @param {String} Value - The value to write. With Key left out, the whole section instead: Key=Value lines.
 * @param {String} Filename - The .ini file's path.
 * @param {String} Section - The section's name, without its brackets.
 * @param {String} Key - The key's name.
 * @example IniWrite 70, "C:\Notes\settings.ini", "Sound", "Volume"
 * @group Programs and files
 * @see https://www.autohotkey.com/docs/v2/lib/IniWrite.htm
 */
IniWrite(Value, Filename, Section, Key?) {
}

/**
 * Reads an environment variable of Windows, such as the path of your user folder.
 * @param {String} EnvVar - The variable's name, such as "USERPROFILE", "TEMP" or "Path".
 * @returns {String} Its value; empty when it is not set.
 * @example Run EnvGet("USERPROFILE") "\Downloads"
 * @group Programs and files
 * @powershell $env:NAME
 * @see https://www.autohotkey.com/docs/v2/lib/EnvGet.htm
 */
EnvGet(EnvVar) {
}

; ************************* Text *************************

/**
 * Gives a piece of a text: the characters from one position on.
 * @param {String} String - The text.
 * @param {Integer} StartingPos - Where the piece starts: 1 for the first character, 2 for the second; a negative number counts from the end, so -3 is the last three.
 * @param {Integer} Length - How many characters at most. Left out, all the rest; a negative number leaves that many off the end.
 * @returns {String} The piece.
 * @example first := SubStr("Macropad", 1, 5)  ; "Macro"
 * @example last := SubStr("Macropad", -3)  ; "pad"
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/SubStr.htm
 */
SubStr(String, StartingPos, Length?) {
}

/**
 * Replaces text with other text, everywhere it appears.
 * @param {String} Haystack - The text to change.
 * @param {String} Needle - The text to look for.
 * @param {String} ReplaceText - What to put in its place. Left out, the Needle is taken out.
 * @param {Boolean} CaseSense - true to match capital and small letters exactly. Left out, false: "a" matches "A".
 * @param {VarRef} OutputVarCount - The variable that gets how many replacements were made, such as &count.
 * @param {Integer} Limit - The most replacements to make, from the left. Left out, -1: all of them.
 * @returns {String} The changed text. Haystack itself stays as it was.
 * @example path := StrReplace("C:/Users/Sam", "/", "\")
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/StrReplace.htm
 */
StrReplace(Haystack, Needle, ReplaceText?, CaseSense?, &OutputVarCount?, Limit?) {
}

/**
 * Finds where a piece of text is in a text.
 * @param {String} Haystack - The text to search.
 * @param {String} Needle - The text to look for.
 * @param {Boolean} CaseSense - true to match capital and small letters exactly. Left out, false.
 * @param {Integer} StartingPos - Where to start looking: 1 for the first character; a negative number searches backwards from that far from the end, -1 from the last character.
 * @param {Integer} Occurrence - Which match to find: 2 for the second. Left out, the first.
 * @returns {Integer} The position of the first character of the match, from 1; 0 (false) when there is none, so it works in an if.
 * @example if InStr(WinGetTitle("A"), "Excel")
 *     Send "^s"
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/InStr.htm
 */
InStr(Haystack, Needle, CaseSense?, StartingPos?, Occurrence?) {
}

/**
 * Cuts a text into pieces at a separator, such as each comma or each line.
 * @param {String} String - The text to cut.
 * @param {String} Delimiters - The separator, such as "," or "`n" for each line; or an array of them: [",", ";"]. Left out, every character becomes a piece.
 * @param {String} OmitChars - Characters to take off both ends of each piece, such as " `t" for spaces and tabs.
 * @param {Integer} MaxParts - The most pieces to make; the last one holds the rest. Left out, -1: no limit.
 * @returns {Array} The pieces, from 1, to go through with a for loop.
 * @example for name in StrSplit("notepad.exe, calc.exe", ",", " ")
 *     Run name
 * @group Text
 * @powershell -split
 * @see https://www.autohotkey.com/docs/v2/lib/StrSplit.htm
 */
StrSplit(String, Delimiters?, OmitChars?, MaxParts?) {
}

/**
 * Counts the characters of a text.
 * @param {String} String - The text.
 * @returns {Integer} How many characters it has.
 * @example if StrLen(A_Clipboard) > 1000
 *     MsgBox "That is a lot of text."
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/StrLen.htm
 */
StrLen(String) {
}

/**
 * Takes spaces and tabs, or other characters you name, off both ends of a text.
 * @param {String} String - The text.
 * @param {String} OmitChars - The characters to take off, each one counted alone: " `t`r`n" also takes line breaks. Left out, spaces and tabs.
 * @returns {String} The trimmed text.
 * @example name := Trim("   Sam   ")  ; "Sam"
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/Trim.htm
 */
Trim(String, OmitChars?) {
}

/**
 * Takes spaces and tabs, or other characters you name, off the start of a text only.
 * @param {String} String - The text.
 * @param {String} OmitChars - The characters to take off, each one counted alone. Left out, spaces and tabs.
 * @returns {String} The trimmed text.
 * @example number := LTrim("000420", "0")  ; "420"
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/Trim.htm
 */
LTrim(String, OmitChars?) {
}

/**
 * Takes spaces and tabs, or other characters you name, off the end of a text only.
 * @param {String} String - The text.
 * @param {String} OmitChars - The characters to take off, each one counted alone. Left out, spaces and tabs.
 * @returns {String} The trimmed text.
 * @example line := RTrim("Done.`r`n", "`r`n")  ; "Done."
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/Trim.htm
 */
RTrim(String, OmitChars?) {
}

/**
 * Builds a text from a pattern with values put in it. {1} stands for the first value, {2} for the second, {} for the next one; after a colon comes how to write it, such as {1:02} for at least two digits with a leading zero.
 * @param {String} FormatStr - The pattern, such as "{1} of {2}". To write a brace itself, put it in braces: {{} or {}}.
 * @param {String} Values - The values to put in, one after another, separated by commas.
 * @returns {String} The text built.
 * @example label := Format("Track {1:02} of {2}", 7, 12)  ; "Track 07 of 12"
 * @group Text
 * @powershell -f
 * @see https://www.autohotkey.com/docs/v2/lib/Format.htm
 */
Format(FormatStr, Values*) {
}

/**
 * Turns every capital letter of a text into a small one.
 * @param {String} String - The text.
 * @returns {String} The text in small letters.
 * @example SendText StrLower(A_Clipboard)
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/StrLower.htm
 */
StrLower(String) {
}

/**
 * Turns every small letter of a text into a capital.
 * @param {String} String - The text.
 * @returns {String} The text in capitals.
 * @example SendText StrUpper(A_Clipboard)
 * @group Text
 * @see https://www.autohotkey.com/docs/v2/lib/StrLower.htm
 */
StrUpper(String) {
}

/**
 * Tells whether a text matches a pattern (a regular expression), and where, and can hand back the parts it found.
 * @param {String} Haystack - The text to search.
 * @param {String} NeedleRegEx - The pattern, in the regular expression language AutoHotkey shares with Perl: \d is a digit, + one or more, ( ) a part to keep. Options go first, before a ): "i)" ignores case.
 * @param {VarRef} OutputVar - The variable that gets the match, such as &m: m[0] is the whole match, m[1] the first part in ( ).
 * @param {Integer} StartingPos - Where to start looking: 1 for the first character. Left out, 1.
 * @returns {Integer} The position of the match, from 1; 0 (false) when there is none.
 * @example if RegExMatch(WinGetTitle("A"), "Invoice (\d+)", &m)
 *     SendText m[1]
 * @group Text
 * @powershell -match, [regex]
 * @see https://www.autohotkey.com/docs/v2/lib/RegExMatch.htm
 */
RegExMatch(Haystack, NeedleRegEx, &OutputVar?, StartingPos?) {
}

/**
 * Replaces every part of a text that matches a pattern (a regular expression).
 * @param {String} Haystack - The text to change.
 * @param {String} NeedleRegEx - The pattern, in the regular expression language AutoHotkey shares with Perl: \s is a space or tab, + one or more. Options go first, before a ): "i)" ignores case.
 * @param {String} Replacement - What to put in each match's place: $1 puts back the first part in ( ). Left out, each match is taken out.
 * @param {VarRef} OutputVarCount - The variable that gets how many replacements were made, such as &count.
 * @param {Integer} Limit - The most replacements to make. Left out, -1: all of them.
 * @param {Integer} StartingPos - Where to start: 1 for the first character. Left out, 1.
 * @returns {String} The changed text.
 * @example tidy := RegExReplace(A_Clipboard, "\s+", " ")  ; every run of spaces and line breaks becomes one space
 * @group Text
 * @powershell -replace, [regex]
 * @see https://www.autohotkey.com/docs/v2/lib/RegExReplace.htm
 */
RegExReplace(Haystack, NeedleRegEx, Replacement?, &OutputVarCount?, Limit?, StartingPos?) {
}

; ************************* The clipboard *************************

/**
 * Waits until the clipboard holds text or files, such as after Send "^c". The clipboard itself is the variable A_Clipboard: read it for its text, and empty it first (A_Clipboard := "") so that the wait is for the new copy.
 * @param {Number} Timeout - The longest wait, in seconds; 0.5 is half a second. Left out, it waits for ever.
 * @param {Integer} WaitFor - 1 to wait for anything at all, pictures included. Left out, 0: text or files.
 * @returns {Integer} 1 (true) when the clipboard holds something, 0 (false) when the time ran out first.
 * @example A_Clipboard := ""
 * Send "^c"
 * if ClipWait(1)
 *     MsgBox "You copied: " A_Clipboard
 * @group The clipboard
 * @see https://www.autohotkey.com/docs/v2/lib/ClipWait.htm
 */
ClipWait(Timeout?, WaitFor?) {
}

/**
 * Takes a copy of everything on the clipboard, pictures and formatting included, to put back later. Put it back by setting A_Clipboard to it.
 * @param {Buffer} Data - Seldom needed: data saved earlier by ClipboardAll, such as read from a file. Left out, what is on the clipboard now.
 * @param {Integer} Size - Seldom needed: how many bytes of Data to use.
 * @returns {ClipboardAll} The copy.
 * @example saved := ClipboardAll()
 * A_Clipboard := "Text to paste"
 * Send "^v"
 * Sleep 200  ; give the program time to paste
 * A_Clipboard := saved  ; what was there before
 * @group The clipboard
 * @see https://www.autohotkey.com/docs/v2/lib/ClipboardAll.htm
 */
ClipboardAll(Data?, Size?) {
}

; ************************* Screen, pixels and images *************************

/**
 * Gives the colour of one pixel. Points count from the top left corner of the inside of the active window, unless CoordMode "Pixel", "Screen" was called first.
 * @param {Integer} X - Pixels from the left.
 * @param {Integer} Y - Pixels from the top.
 * @param {String} Mode - Seldom needed: "Alt" or "Slow" for windows where the usual way reads the wrong colour.
 * @returns {String} The colour in red-green-blue form, such as "0xFF0000" for red.
 * @example CoordMode "Pixel", "Screen"
 * if PixelGetColor(100, 200) = "0xFFFFFF"
 *     MsgBox "That pixel is white."
 * @group Screen, pixels and images
 * @powershell Get-PixelColor
 * @see https://www.autohotkey.com/docs/v2/lib/PixelGetColor.htm
 */
PixelGetColor(X, Y, Mode?) {
}

/**
 * Looks for a pixel of a colour within a rectangle of the screen. Points count from the top left corner of the inside of the active window, unless CoordMode "Pixel", "Screen" was called first.
 * @param {VarRef} OutputVarX - The variable that gets the X of the pixel found, such as &x.
 * @param {VarRef} OutputVarY - The variable that gets its Y, such as &y.
 * @param {Integer} X1 - The left edge of the rectangle to search.
 * @param {Integer} Y1 - Its top edge.
 * @param {Integer} X2 - Its right edge.
 * @param {Integer} Y2 - Its bottom edge.
 * @param {Integer} ColorID - The colour in red-green-blue form, such as 0xFF0000 for red. Window Spy shows the colour under the pointer.
 * @param {Integer} Variation - How far, from 0 to 255, each of red, green and blue may be from it and still count. Left out, 0: only that exact colour.
 * @returns {Integer} 1 (true) when the colour was found, 0 (false) when not.
 * @example CoordMode "Pixel", "Screen"
 * if PixelSearch(&x, &y, 0, 0, A_ScreenWidth, A_ScreenHeight, 0xFF0000, 10)
 *     Click x, y
 * @group Screen, pixels and images
 * @powershell Find-Pixel
 * @see https://www.autohotkey.com/docs/v2/lib/PixelSearch.htm
 */
PixelSearch(&OutputVarX, &OutputVarY, X1, Y1, X2, Y2, ColorID, Variation?) {
}

/**
 * Looks for a picture on the screen, such as a button you saved as a PNG, within a rectangle. Points count from the top left corner of the inside of the active window, unless CoordMode "Pixel", "Screen" was called first.
 * @param {VarRef} OutputVarX - The variable that gets the X of the found picture's top left corner, such as &x.
 * @param {VarRef} OutputVarY - The variable that gets its Y, such as &y.
 * @param {Integer} X1 - The left edge of the rectangle to search.
 * @param {Integer} Y1 - Its top edge.
 * @param {Integer} X2 - Its right edge.
 * @param {Integer} Y2 - Its bottom edge.
 * @param {String} ImageFile - The picture's path (PNG, BMP, JPG, GIF and more). Options go before it, each followed by a space: "*50 " lets each colour be up to 50 shades off, which helps with pictures saved as JPG.
 * @returns {Integer} 1 (true) when the picture was found, 0 (false) when not.
 * @example CoordMode "Pixel", "Screen"
 * if ImageSearch(&x, &y, 0, 0, A_ScreenWidth, A_ScreenHeight, "*30 C:\Pictures\ok-button.png")
 *     Click x + 10, y + 10
 * @group Screen, pixels and images
 * @powershell Find-Image
 * @see https://www.autohotkey.com/docs/v2/lib/ImageSearch.htm
 */
ImageSearch(&OutputVarX, &OutputVarY, X1, Y1, X2, Y2, ImageFile) {
}

/**
 * Finds where a monitor's edges are on the whole desktop. Each value goes into a variable you name with & in front.
 * @param {Integer} N - Which monitor, from 1. Left out, the main one.
 * @param {VarRef} Left - The variable that gets the X of its left edge.
 * @param {VarRef} Top - The variable that gets the Y of its top edge.
 * @param {VarRef} Right - The variable that gets the X of its right edge.
 * @param {VarRef} Bottom - The variable that gets the Y of its bottom edge.
 * @returns {Integer} The monitor's number.
 * @example MonitorGet 2, &left, &top, &right, &bottom
 * WinMove left, top, , , "A"  ; the active window to the second monitor
 * @group Screen, pixels and images
 * @powershell [System.Windows.Forms.Screen]::AllScreens
 * @see https://www.autohotkey.com/docs/v2/lib/MonitorGet.htm
 */
MonitorGet(N?, &Left?, &Top?, &Right?, &Bottom?) {
}

/**
 * Finds the part of a monitor that windows may use: the monitor less the taskbar. Each value goes into a variable you name with & in front.
 * @param {Integer} N - Which monitor, from 1. Left out, the main one.
 * @param {VarRef} Left - The variable that gets the X of its left edge.
 * @param {VarRef} Top - The variable that gets the Y of its top edge.
 * @param {VarRef} Right - The variable that gets the X of its right edge.
 * @param {VarRef} Bottom - The variable that gets the Y of its bottom edge.
 * @returns {Integer} The monitor's number.
 * @example MonitorGetWorkArea , &left, &top, &right, &bottom
 * WinMove left, top, (right - left) // 2, bottom - top, "A"  ; the left half of the main monitor
 * @group Screen, pixels and images
 * @powershell [System.Windows.Forms.Screen]::AllScreens
 * @see https://www.autohotkey.com/docs/v2/lib/MonitorGetWorkArea.htm
 */
MonitorGetWorkArea(N?, &Left?, &Top?, &Right?, &Bottom?) {
}

/**
 * Reads one of Windows' system measurements, such as the size of the main screen or how many mouse buttons there are. The numbers are listed on the page.
 * @param {Integer} Property - Which measurement: 0 the width of the main screen, 1 its height, 43 the number of mouse buttons, 80 the number of monitors.
 * @returns {Integer} The measurement.
 * @example monitors := SysGet(80)
 * @group Screen, pixels and images
 * @powershell [System.Windows.Forms.SystemInformation]
 * @see https://www.autohotkey.com/docs/v2/lib/SysGet.htm
 */
SysGet(Property) {
}

; ************************* Sound *************************

/**
 * Gives the volume of the speakers, or of another sound device, as a percentage.
 * @param {String} Component - Seldom needed: a part of the device, such as "Line in". Left out, its main volume.
 * @param {String} Device - Which device, by its name such as "Speakers" or its number. Left out, the default one for playback.
 * @returns {Number} The volume, from 0.0 to 100.0.
 * @example ToolTip "Volume: " Round(SoundGetVolume()) "%"
 * @group Sound
 * @powershell Get-SoundVolume
 * @see https://www.autohotkey.com/docs/v2/lib/SoundGetVolume.htm
 */
SoundGetVolume(Component?, Device?) {
}

/**
 * Sets the volume of the speakers, or of another sound device, or turns it up or down.
 * @param {String} NewSetting - The volume as a percentage from 0 to 100; or, with a + or - in front, how much to turn it up or down: "+10", -10. A + needs quotes, as a number loses it.
 * @param {String} Component - Seldom needed: a part of the device, such as "Line in". Left out, its main volume.
 * @param {String} Device - Which device, by its name such as "Speakers" or its number. Left out, the default one for playback.
 * @example SoundSetVolume "+10"
 * @example SoundSetVolume 30
 * @group Sound
 * @powershell Set-SoundVolume
 * @see https://www.autohotkey.com/docs/v2/lib/SoundSetVolume.htm
 */
SoundSetVolume(NewSetting, Component?, Device?) {
}

/**
 * Tells whether the speakers, or another sound device, are muted.
 * @param {String} Component - Seldom needed: a part of the device, such as "Line in". Left out, its main mute.
 * @param {String} Device - Which device, by its name such as "Speakers" or its number. Left out, the default one for playback.
 * @returns {Integer} 1 (true) when muted, 0 (false) when not.
 * @example if SoundGetMute()
 *     ToolTip "Muted"
 * @group Sound
 * @powershell Get-SoundMute
 * @see https://www.autohotkey.com/docs/v2/lib/SoundGetMute.htm
 */
SoundGetMute(Component?, Device?) {
}

/**
 * Mutes or unmutes the speakers, or another sound device.
 * @param {Integer} NewSetting - 1 to mute, 0 to unmute, -1 to switch between the two.
 * @param {String} Component - Seldom needed: a part of the device, such as "Line in". Left out, its main mute.
 * @param {String} Device - Which device, by its name such as "Speakers" or its number. Left out, the default one for playback.
 * @example SoundSetMute -1
 * @group Sound
 * @powershell Set-SoundMute, Switch-SoundMute
 * @see https://www.autohotkey.com/docs/v2/lib/SoundSetMute.htm
 */
SoundSetMute(NewSetting, Component?, Device?) {
}

/**
 * Plays a beep, and waits until it is over.
 * @param {Integer} Frequency - How high the beep is, in hertz, from 37 to 32767.
 * @param {Integer} Duration - How long it lasts, in milliseconds.
 * @example SoundBeep
 * @example SoundBeep 1000, 300
 * @group Sound
 * @see https://www.autohotkey.com/docs/v2/lib/SoundBeep.htm
 */
SoundBeep(Frequency := 523, Duration := 150) {
}

; ************************* Waiting and timing *************************

/**
 * Waits for a time before the command goes on, for example to give a program time to open or to show a menu.
 * @param {Integer} Delay - How long to wait, in milliseconds: 1000 is one second.
 * @example Send "#r"
 * Sleep 300  ; give the Run box time to open
 * SendText "notepad`n"
 * @group Waiting and timing
 * @powershell Wait-Pump
 * @see https://www.autohotkey.com/docs/v2/lib/Sleep.htm
 */
Sleep(Delay) {
}

/**
 * Runs a function later, once or again and again, while the command and the macropad go on.
 * @param {Func} Function - What to run: the name of a function, without quotes, or an expression such as () => ToolTip(). Left out, inside a function a timer runs, that timer.
 * @param {Integer} Period - Milliseconds: a positive number runs it every that many; a negative number runs it once, after that many; 0 stops the timer. Left out, 250 for a new timer.
 * @param {Integer} Priority - Seldom needed: which of several running things goes first. Left out, 0.
 * @example ToolTip "Saved"
 * SetTimer () => ToolTip(), -2000  ; takes the tooltip away in 2 seconds
 * @group Waiting and timing
 * @powershell System.Windows.Forms.Timer
 * @see https://www.autohotkey.com/docs/v2/lib/SetTimer.htm
 */
SetTimer(Function?, Period?, Priority?) {
}

/**
 * Waits until a key or mouse button is let go of, or until it is pressed down.
 * @param {String} KeyName - The key: a character such as "a", or a name such as "Shift", "Space" or "LButton".
 * @param {String} Options - "D" to wait until it is pressed down instead; "T" and a number to wait at most that many seconds ("T2"). Left out, it waits for ever for the key to be let go of.
 * @returns {Integer} 1 (true) when the key got there, 0 (false) when the time ran out first.
 * @example KeyWait "Shift"  ; until Shift is let go of
 * @example if !KeyWait("Space", "D T3")
 *     MsgBox "Space was not pressed within 3 seconds."
 * @group Waiting and timing
 * @powershell Wait-Key
 * @see https://www.autohotkey.com/docs/v2/lib/KeyWait.htm
 */
KeyWait(KeyName, Options?) {
}

/**
 * Waits until a window exists, such as one a program opens after Run. The window it finds becomes the last found window, which later Win functions use when their WinTitle is left out.
 * @param {String} WinTitle - Which window: part of its title such as "Notepad", or "ahk_exe notepad.exe" for any window of that program, or "ahk_class " and a class name. This or WinText must be given.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {Number} Timeout - The longest wait, in seconds; 0.5 is half a second. Left out, it waits for ever.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The window's handle; 0 (false) when the time ran out first.
 * @example Run "notepad.exe"
 * if WinWait("ahk_exe notepad.exe", , 5)
 *     WinMaximize  ; the window WinWait found
 * @group Waiting and timing
 * @powershell Wait-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinWait.htm
 */
WinWait(WinTitle?, WinText?, Timeout?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Waits until a window is the active window. The window it finds becomes the last found window.
 * @param {String} WinTitle - Which window: part of its title such as "Notepad", or "ahk_exe notepad.exe" for any window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {Number} Timeout - The longest wait, in seconds. Left out, it waits for ever.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} The window's handle; 0 (false) when the time ran out first.
 * @example WinActivate "ahk_exe notepad.exe"
 * if WinWaitActive("ahk_exe notepad.exe", , 2)
 *     Send "^a"
 * @group Waiting and timing
 * @powershell Wait-Window
 * @see https://www.autohotkey.com/docs/v2/lib/WinWaitActive.htm
 */
WinWaitActive(WinTitle?, WinText?, Timeout?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Waits until a window is no longer the active window.
 * @param {String} WinTitle - Which window: part of its title such as "Notepad", or "ahk_exe notepad.exe" for any window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {Number} Timeout - The longest wait, in seconds. Left out, it waits for ever.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} 1 (true) when it is no longer active, 0 (false) when the time ran out first.
 * @example WinWaitNotActive "ahk_exe notepad.exe", , 10
 * @group Waiting and timing
 * @powershell Wait-WindowClose
 * @see https://www.autohotkey.com/docs/v2/lib/WinWaitActive.htm
 */
WinWaitNotActive(WinTitle?, WinText?, Timeout?, ExcludeTitle?, ExcludeText?) {
}

/**
 * Waits until a window no longer exists, such as after WinClose.
 * @param {String} WinTitle - Which window: part of its title such as "Notepad", or "ahk_exe notepad.exe" for any window of that program, or a window handle. Left out, the last found window.
 * @param {String} WinText - Text that must appear inside the window, as Window Spy lists it. Usually left out.
 * @param {Number} Timeout - The longest wait, in seconds. Left out, it waits for ever.
 * @param {String} ExcludeTitle - Leaves out windows whose title contains this.
 * @param {String} ExcludeText - Leaves out windows that show this text inside them.
 * @returns {Integer} 1 (true) when the window is gone, 0 (false) when the time ran out first.
 * @example WinClose "ahk_exe notepad.exe"
 * if !WinWaitClose("ahk_exe notepad.exe", , 3)
 *     MsgBox "Notepad is still open: it may be asking whether to save."
 * @group Waiting and timing
 * @powershell Wait-WindowClose
 * @see https://www.autohotkey.com/docs/v2/lib/WinWaitClose.htm
 */
WinWaitClose(WinTitle?, WinText?, Timeout?, ExcludeTitle?, ExcludeText?) {
}

; ************************* Messages and dialogs *************************

/**
 * Shows a message in a small window with buttons, and waits until one is pressed.
 * @param {String} Text - The message. "`n" in it starts a new line.
 * @param {String} Title - The title of the box. Left out, the macropad script's file name.
 * @param {String} Options - Which buttons and icon, separated by spaces: "OKCancel", "YesNo", "YesNoCancel" or "RetryCancel"; "Iconi" (information), "Icon!" (warning), "IconX" (error) or "Icon?" (question); "T" and a number to close it by itself after that many seconds. Left out, one OK button.
 * @returns {String} The button pressed: "OK", "Cancel", "Yes", "No", "Retry" and so on; "Timeout" when the time ran out.
 * @example MsgBox "Done."
 * @example if MsgBox("Close Notepad?", "Macropad", "YesNo Icon?") = "Yes"
 *     WinClose "ahk_exe notepad.exe"
 * @group Messages and dialogs
 * @powershell Show-MessageBox
 * @see https://www.autohotkey.com/docs/v2/lib/MsgBox.htm
 */
MsgBox(Text?, Title?, Options?) {
}

/**
 * Asks for a line of text in a small window with OK and Cancel, and waits for the answer.
 * @param {String} Prompt - The question shown above the box.
 * @param {String} Title - The title of the window. Left out, the macropad script's file name.
 * @param {String} Options - Seldom needed, separated by spaces: "W" and "H" with numbers for its size, "T" and a number to close it by itself after that many seconds, "Password" to hide what is typed.
 * @param {String} Default - Text already in the box when it opens.
 * @returns {Object} An object whose Value is the text typed, and whose Result is "OK", "Cancel" or "Timeout".
 * @example answer := InputBox("Search for what?", "Search")
 * if answer.Result = "OK"
 *     Run "https://www.google.com/search?q=" answer.Value
 * @group Messages and dialogs
 * @powershell [Microsoft.VisualBasic.Interaction]::InputBox
 * @see https://www.autohotkey.com/docs/v2/lib/InputBox.htm
 */
InputBox(Prompt?, Title?, Options?, Default?) {
}

/**
 * Shows a small note near the mouse pointer, or at a point, that stays until it is taken away; ToolTip with nothing given takes it away.
 * @param {String} Text - What it says. "`n" in it starts a new line. Left out, the note is taken away.
 * @param {Integer} X - Where it goes, pixels from the left. Points count from the top left corner of the inside of the active window, unless CoordMode "ToolTip", "Screen" was called first. Left out, near the pointer.
 * @param {Integer} Y - Where it goes, pixels from the top. Left out, near the pointer.
 * @param {Integer} WhichToolTip - Which of up to 20 notes, so several can show at once. Left out, 1.
 * @returns {Integer} The note's window handle; nothing when it is taken away.
 * @example ToolTip "Copied"
 * SetTimer () => ToolTip(), -1500  ; takes it away in 1.5 seconds
 * @group Messages and dialogs
 * @powershell Show-ToolTip, Hide-ToolTip
 * @see https://www.autohotkey.com/docs/v2/lib/ToolTip.htm
 */
ToolTip(Text?, X?, Y?, WhichToolTip?) {
}

/**
 * Shows a Windows notification, the kind that slides in at the corner of the screen. TrayTip with nothing given takes it away.
 * @param {String} Text - The message.
 * @param {String} Title - The title line, in bold.
 * @param {String} Options - An icon, "Iconi" (information), "Icon!" (warning) or "Iconx" (error); "Mute" for no sound. Separated by spaces.
 * @example TrayTip "The backup is done.", "Macropad", "Iconi"
 * @group Messages and dialogs
 * @powershell NotifyIcon.ShowBalloonTip
 * @see https://www.autohotkey.com/docs/v2/lib/TrayTip.htm
 */
TrayTip(Text?, Title?, Options?) {
}

/**
 * Makes a window of your own, to which you add text, buttons, boxes to type in and lists, and then show. Its page lists every kind of control and option.
 * @param {String} Options - How the window behaves, such as "+AlwaysOnTop", "+Resize" or "-Caption" (no title bar).
 * @param {String} Title - The text in its title bar.
 * @param {Object} EventObj - Seldom needed: an object whose methods handle the window's events.
 * @returns {Gui} The window, with Add, Show and Destroy methods and more.
 * @example g := Gui("+AlwaysOnTop", "Note")
 * g.Add("Text", , "Remember to stretch.")
 * g.Add("Button", "Default", "OK").OnEvent("Click", (*) => g.Destroy())
 * g.Show()
 * @group Messages and dialogs
 * @powershell WinForms
 * @see https://www.autohotkey.com/docs/v2/lib/Gui.htm
 */
Gui(Options?, Title?, EventObj?) {
}

/**
 * Makes a menu of your own, which you fill with items and show where the mouse pointer is: a quick way to give one key several choices.
 * @returns {Menu} The menu, with Add, to add an item and what it does, and Show methods.
 * @example m := Menu()
 * m.Add("Notepad", (*) => Run("notepad.exe"))
 * m.Add("Calculator", (*) => Run("calc.exe"))
 * m.Show()
 * @group Messages and dialogs
 * @powershell ContextMenuStrip
 * @see https://www.autohotkey.com/docs/v2/lib/Menu.htm
 */
Menu() {
}

; ************************* Other *************************

/**
 * Calls a function of Windows itself, inside one of its DLL files, for what no AutoHotkey function does. The function's documentation, from Microsoft, says what it takes. A wrong call can crash the macropad.
 * @param {String} Function - The DLL file and the function's name, such as "user32\LockWorkStation". A function of User32, Kernel32, ComCtl32 or Gdi32 needs only its name.
 * @param {String} Type1 - The type of the first value passed, such as "Int", "UInt", "Ptr" or "Str". More pairs of a type and a value may follow.
 * @param {String} Arg1 - The first value passed.
 * @param {String} ReturnType - The type of what the function gives back, last of all. Left out, "Int".
 * @returns {Integer} What the function gave back.
 * @example DllCall("LockWorkStation")  ; locks the computer, as Win+L does
 * @example DllCall("SetCursorPos", "Int", 100, "Int", 200)
 * @group Other
 * @powershell Add-Type
 * @see https://www.autohotkey.com/docs/v2/lib/DllCall.htm
 */
DllCall(Function, Type1?, Arg1?, ReturnType?) {
}

/**
 * Makes a COM object: a way into a program or a part of Windows that offers one, such as Windows' speech voice or Excel.
 * @param {String} CLSID - The object's name, such as "SAPI.SpVoice" or "Excel.Application", or its CLSID in braces.
 * @param {String} IID - Seldom needed: which interface of it. Left out, the usual one.
 * @returns {ComObject} The object; its methods are the program's own.
 * @example ComObject("SAPI.SpVoice").Speak("Meeting in five minutes")
 * @group Other
 * @powershell New-Object -ComObject
 * @see https://www.autohotkey.com/docs/v2/lib/ComObject.htm
 */
ComObject(CLSID, IID?) {
}

/**
 * Calls a method of a COM object by its number, for an object AutoHotkey cannot call by name. Needs the object's documentation from Microsoft; a wrong call can crash the macropad.
 * @param {Integer} Index - The method's number in the object's table of methods, from 0.
 * @param {Object} ComObj - The object, or its address.
 * @param {String} Type1 - The type of the first value passed, as for DllCall. More pairs of a type and a value may follow.
 * @param {String} Arg1 - The first value passed.
 * @param {String} ReturnType - The type of what the method gives back, last of all. Left out, "HRESULT", and a failure stops the command with an error.
 * @returns {Integer} What the method gave back.
 * @example ; store, key and value as ahk/commands/helper.ahk makes them
 * hr := ComCall(5, store, "Ptr", key, "Ptr", value)  ; IPropertyStore::GetValue
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/ComCall.htm
 */
ComCall(Index, ComObj, Type1?, Arg1?, ReturnType?) {
}

/**
 * Reserves a block of memory, for a DllCall or ComCall that fills or reads one. NumPut, NumGet and StrGet write and read it.
 * @param {Integer} ByteCount - How many bytes.
 * @param {Integer} FillByte - A number from 0 to 255 to fill every byte with. Left out, the bytes are left as they are.
 * @returns {Buffer} The block, with its address in Ptr and its size in Size.
 * @example point := Buffer(8, 0)
 * DllCall("GetCursorPos", "Ptr", point)
 * x := NumGet(point, 0, "Int")
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/Buffer.htm
 */
Buffer(ByteCount?, FillByte?) {
}

/**
 * Reads a number from a block of memory, such as one a DllCall filled.
 * @param {Buffer} Source - The Buffer, or a memory address.
 * @param {Integer} Offset - How many bytes from the start. Left out, 0.
 * @param {String} Type - What kind of number: "Int", "UInt", "Short", "UShort", "Char", "UChar", "Int64", "Ptr", "Float" or "Double".
 * @returns {Number} The number.
 * @example point := Buffer(8)
 * DllCall("GetCursorPos", "Ptr", point)
 * y := NumGet(point, 4, "Int")
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/NumGet.htm
 */
NumGet(Source, Offset?, Type) {
}

/**
 * Writes a number into a block of memory, such as one a DllCall will read. More pairs of a type and a number may come before Target, to write them one after another.
 * @param {String} Type - What kind of number: "Int", "UInt", "Short", "UShort", "Char", "UChar", "Int64", "Ptr", "Float" or "Double".
 * @param {Number} Number - The number to write.
 * @param {Buffer} Target - The Buffer, or a memory address.
 * @param {Integer} Offset - How many bytes from the start. Left out, 0.
 * @returns {Integer} The address right after what was written.
 * @example rect := Buffer(16)
 * NumPut("Int", 0, "Int", 0, "Int", 800, "Int", 600, rect)  ; a RECT: left, top, right, bottom
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/NumPut.htm
 */
NumPut(Type, Number, Target, Offset?) {
}

/**
 * Reads text from a block of memory, such as a name a DllCall wrote.
 * @param {Buffer} Source - The Buffer, or a memory address.
 * @param {Integer} Length - How many characters at most. Left out, up to the end of the text.
 * @param {String} Encoding - How the text is stored, such as "UTF-8" or "UTF-16". Left out, as AutoHotkey stores text.
 * @returns {String} The text.
 * @example buf := Buffer(6)
 * StrPut("Hello", buf, "UTF-8")
 * text := StrGet(buf, "UTF-8")  ; "Hello"
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/StrGet.htm
 */
StrGet(Source, Length?, Encoding?) {
}

/**
 * Tells whether a variable has a value yet, such as a global that the first press of a key sets.
 * @param {Variable} Var - The variable, written plainly, without quotes.
 * @returns {Integer} 1 (true) when it has a value, 0 (false) when it has none.
 * @example global counter
 * if !IsSet(counter)
 *     counter := 0
 * counter += 1
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/IsSet.htm
 */
IsSet(Var) {
}

/**
 * Turns a text of digits, or a number with a fraction, into a whole number; the fraction is dropped. Stops the command with an error when it is not a number.
 * @param {String} Value - The text or number, such as "42" or 3.9.
 * @returns {Integer} The whole number: 42, or 3.
 * @example count := Integer(InputBox("How many?").Value)
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/Integer.htm
 */
Integer(Value) {
}

/**
 * Gives the smallest of some numbers.
 * @param {Number} Number1 - The first number.
 * @param {Number} Number2 - The other numbers, separated by commas.
 * @returns {Number} The smallest.
 * @example SoundSetVolume Min(SoundGetVolume() + 20, 100)
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/Math.htm#Min
 */
Min(Number1, Number2*) {
}

/**
 * Gives the largest of some numbers.
 * @param {Number} Number1 - The first number.
 * @param {Number} Number2 - The other numbers, separated by commas.
 * @returns {Number} The largest.
 * @example SoundSetVolume Max(SoundGetVolume() - 20, 0)
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/Math.htm#Max
 */
Max(Number1, Number2*) {
}

/**
 * Reads a value from the Windows registry, where Windows and programs keep their settings. Stops the command with an error when it is not there, unless Default is given.
 * @param {String} KeyName - The key, starting with its root: "HKCU" (your settings), "HKLM" (the computer's), then the path: "HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize".
 * @param {String} ValueName - The value's name. Left out, the key's default value.
 * @param {String} Default - What to give when the key or value is not there.
 * @returns {String} The value: text, or a number.
 * @example light := RegRead("HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1)
 * @group Other
 * @powershell Get-ItemProperty
 * @see https://www.autohotkey.com/docs/v2/lib/RegRead.htm
 */
RegRead(KeyName?, ValueName?, Default?) {
}

/**
 * Writes a value into the Windows registry, where Windows and programs keep their settings. A wrong value can upset Windows or a program: change only what you know.
 * @param {String} Value - What to write.
 * @param {String} ValueType - Its kind: "REG_SZ" (text), "REG_DWORD" (a number), "REG_EXPAND_SZ", "REG_MULTI_SZ" or "REG_BINARY".
 * @param {String} KeyName - The key, starting with its root: "HKCU" (your settings) or "HKLM" (the computer's, which needs the macropad to run as administrator), then the path.
 * @param {String} ValueName - The value's name. Left out, the key's default value.
 * @example ; dark mode for apps: 0; light: 1
 * RegWrite 0, "REG_DWORD", "HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme"
 * @group Other
 * @powershell Set-ItemProperty
 * @see https://www.autohotkey.com/docs/v2/lib/RegWrite.htm
 */
RegWrite(Value, ValueType?, KeyName?, ValueName?) {
}

/**
 * Closes the macropad's AutoHotkey script altogether: its keys stop working until it is started again.
 * @param {Integer} ExitCode - The number the script ends with. Left out, 0.
 * @example ExitApp
 * @group Other
 * @powershell [System.Windows.Forms.Application]::Exit()
 * @see https://www.autohotkey.com/docs/v2/lib/ExitApp.htm
 */
ExitApp(ExitCode?) {
}

/**
 * Starts the macropad's AutoHotkey script again, so that it reads its files afresh: the way to pick up a change to a command file or the layout.
 * @example Reload
 * @group Other
 * @see https://www.autohotkey.com/docs/v2/lib/Reload.htm
 */
Reload() {
}
