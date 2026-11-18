#Requires AutoHotkey v2.0

/**
 * Opens a small form that sends a key, or a Send sequence such as "^+{t}", after a delay. "Record key" captures the next key pressed with the Ctrl, Shift and Alt keys held with it. Opening the form again cancels a send it scheduled.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ShowDelayedKeyForm(Macro) {
	global AutomationKey, AutomationDelay, AutomationGui
	global AutomationCaptureStatus

	; Opening the form again cancels the send it scheduled, as the PowerShell version does.
	SetTimer(AutomationSendPending, 0)
	if (IsSet(AutomationGui))
		AutomationGui.Destroy()

	AutomationGui := Gui("+AlwaysOnTop", "Send key after delay")
	AutomationGui.AddText(, "Key or Send sequence:")
	AutomationKey := AutomationGui.AddEdit("w220")
	AutomationGui.AddButton("x+5", "Record key").OnEvent("Click", AutomationRecordKey)
	AutomationCaptureStatus := AutomationGui.AddText("w280", "Click Record key; recording times out after 5 seconds.")
	AutomationGui.AddText(, "Delay in milliseconds:")
	AutomationDelay := AutomationGui.AddEdit("w100 Number", "1000")
	AutomationGui.AddButton("Default", "Schedule").OnEvent("Click", AutomationSchedule)
	AutomationGui.OnEvent("Close", AutomationGuiClose)
	AutomationGui.Show()
}

AutomationSchedule(*) {
	global AutomationKey, AutomationDelay, AutomationGui
	global AutomationPendingKey

	key := AutomationKey.Value
	delay := AutomationDelay.Value
	if (key = "" || !RegExMatch(delay, "^\d+$")) {
		MsgBox("Enter a key and a delay in milliseconds.", "Invalid input", "Icon!")
		return
	}

	AutomationPendingKey := key
	AutomationGui.Hide()
	SetTimer(AutomationSendPending, -AutomationTimerDelay(delay))
}

; The delay to give SetTimer, from a text of digits: at least 1 ms (SetTimer deletes a timer given 0)
; and at most 2147483647 ms (Int32 max, as in PowerShell; SetTimer refuses more than 4294967295).
AutomationTimerDelay(Delay) {
	Delay := LTrim(Delay, "0")
	if (Delay = "")
		return 1
	if (StrLen(Delay) > 10)  ; more digits than Integer() can hold safely, and over the maximum anyway
		return 2147483647
	return Min(Integer(Delay), 2147483647)
}

AutomationRecordKey(*) {
	global AutomationCaptureHook, AutomationCaptureStatus, AutomationCaptureDone

	if (IsSet(AutomationCaptureHook))
		AutomationCaptureHook.Stop()
	AutomationCaptureDone := false
	AutomationCaptureStatus.Value := "Press a key (5-second timeout)..."
	AutomationCaptureHook := InputHook()
	AutomationCaptureHook.Timeout := 5
	AutomationCaptureHook.KeyOpt("{All}", "N")
	AutomationCaptureHook.OnKeyDown := AutomationCaptureKeyDown
	AutomationCaptureHook.OnEnd := AutomationCaptureEnded
	AutomationCaptureHook.Start()
}

AutomationCaptureKeyDown(ih, vk, sc) {
	global AutomationKey, AutomationCaptureDone, AutomationCaptureStatus

	keyName := GetKeyName(Format("vk{:02X}sc{:03X}", vk, sc))
	; Skip a modifier pressed on its own (the hook names it LControl, RShift, ...) and record the next
	; key with the modifiers held, as the PowerShell form does.
	if (keyName = "" || InStr("|Control|LControl|RControl|Shift|LShift|RShift|Alt|LAlt|RAlt|LWin|RWin|", "|" keyName "|"))
		return
	mods := (GetKeyState("Ctrl", "P") ? "^" : "") (GetKeyState("Shift", "P") ? "+" : "") (GetKeyState("Alt", "P") ? "!" : "")
	AutomationKey.Value := mods "{" keyName "}"
	AutomationCaptureDone := true
	AutomationCaptureStatus.Value := "Recorded " AutomationKey.Value "."
	ih.Stop()
}

AutomationCaptureEnded(ih) {
	global AutomationCaptureHook, AutomationCaptureStatus, AutomationCaptureDone
	if (ih != AutomationCaptureHook)  ; a recording that a newer one replaced
		return
	if (!AutomationCaptureDone)
		AutomationCaptureStatus.Value := "No key recorded; timed out."
}

AutomationSendPending() {
	global AutomationPendingKey
	SendInput(AutomationPendingKey)
}

AutomationGuiClose(*) {
	global AutomationGui, AutomationCaptureHook
	; A recording still running would keep holding back the next key typed anywhere.
	if (IsSet(AutomationCaptureHook))
		AutomationCaptureHook.Stop()
	AutomationGui.Hide()
}

/**
 * Opens a small form that records one mouse click (its button and screen position) and replays it after a delay. Opening the form again cancels a click it scheduled.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
ShowDelayedClickForm(Macro) {
	global AutomationClickGui, AutomationClickDelay, AutomationClickStatus
	global AutomationClickCaptured

	; Opening the form again cancels the click it scheduled.
	SetTimer(AutomationSendPendingClick, 0)
	if (IsSet(AutomationClickGui))
		AutomationClickGui.Destroy()

	AutomationClickCaptured := false
	AutomationClickGui := Gui("+AlwaysOnTop", "Click after delay")
	AutomationClickGui.AddText(, "Record a mouse click, then schedule its replay:")
	AutomationClickGui.AddButton(, "Record click").OnEvent("Click", AutomationRecordClick)
	AutomationClickStatus := AutomationClickGui.AddText("w300", "Click Record; capture times out after 5 seconds.")
	AutomationClickGui.AddText(, "Delay in milliseconds:")
	AutomationClickDelay := AutomationClickGui.AddEdit("w100 Number", "1000")
	AutomationClickGui.AddButton("Default", "Schedule").OnEvent("Click", AutomationScheduleClick)
	AutomationClickGui.OnEvent("Close", AutomationClickGuiClose)
	AutomationClickGui.Show()
}

AutomationRecordClick(*) {
	global AutomationClickCaptureStarted, AutomationClickWaitingForRelease
	global AutomationClickCaptured, AutomationClickStatus

	SetTimer(AutomationCaptureClickTick, 0)
	AutomationClickCaptured := false
	AutomationClickCaptureStarted := A_TickCount
	; Ignore the mouse-down that clicked Record itself.
	AutomationClickWaitingForRelease := AutomationAnyMouseButtonDown()
	AutomationClickStatus.Value := "Click a mouse button (5-second timeout)..."
	SetTimer(AutomationCaptureClickTick, 10)
}

AutomationCaptureClickTick() {
	global AutomationClickCaptureStarted, AutomationClickWaitingForRelease
	global AutomationClickCaptured, AutomationClickX, AutomationClickY, AutomationClickButton
	global AutomationClickStatus

	if (A_TickCount - AutomationClickCaptureStarted >= 5000) {
		SetTimer(AutomationCaptureClickTick, 0)
		AutomationClickStatus.Value := "No click recorded; timed out."
		return
	}

	if (AutomationClickWaitingForRelease) {
		if (!AutomationAnyMouseButtonDown())
			AutomationClickWaitingForRelease := false
		return
	}

	button := AutomationPressedMouseButton()
	if (button = "")
		return

	CoordMode("Mouse", "Screen")
	MouseGetPos(&AutomationClickX, &AutomationClickY)
	AutomationClickButton := button
	AutomationClickCaptured := true
	SetTimer(AutomationCaptureClickTick, 0)
	AutomationClickStatus.Value := "Captured " button " click at " AutomationClickX ", " AutomationClickY "."
}

AutomationAnyMouseButtonDown() {
	return GetKeyState("LButton", "P") || GetKeyState("RButton", "P")
		|| GetKeyState("MButton", "P") || GetKeyState("XButton1", "P")
		|| GetKeyState("XButton2", "P")
}

AutomationPressedMouseButton() {
	if (GetKeyState("LButton", "P"))
		return "Left"
	if (GetKeyState("RButton", "P"))
		return "Right"
	if (GetKeyState("MButton", "P"))
		return "Middle"
	if (GetKeyState("XButton1", "P"))
		return "X1"
	if (GetKeyState("XButton2", "P"))
		return "X2"
	return ""
}

AutomationScheduleClick(*) {
	global AutomationClickGui, AutomationClickDelay, AutomationClickCaptured
	global AutomationClickX, AutomationClickY, AutomationClickButton
	global AutomationPendingClickX, AutomationPendingClickY, AutomationPendingClickButton

	delay := AutomationClickDelay.Value
	if (!AutomationClickCaptured || !RegExMatch(delay, "^\d+$")) {
		MsgBox("Record a click and enter a delay in milliseconds.", "Invalid input", "Icon!")
		return
	}

	AutomationPendingClickX := AutomationClickX
	AutomationPendingClickY := AutomationClickY
	AutomationPendingClickButton := AutomationClickButton
	AutomationClickGui.Hide()
	SetTimer(AutomationSendPendingClick, -AutomationTimerDelay(delay))
}

AutomationSendPendingClick() {
	global AutomationPendingClickX, AutomationPendingClickY, AutomationPendingClickButton
	CoordMode("Mouse", "Screen")
	Click(AutomationPendingClickX, AutomationPendingClickY, AutomationPendingClickButton)
}

AutomationClickGuiClose(*) {
	global AutomationClickGui
	SetTimer(AutomationCaptureClickTick, 0)
	AutomationClickGui.Hide()
}

