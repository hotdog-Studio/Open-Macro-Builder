; AutoHotkey v2. Call ShowDelayedKeyForm() to open the form.
ShowDelayedKeyForm(Macro) {
	global AutomationKey, AutomationDelay, AutomationGui
	global AutomationCaptureStatus

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
	SetTimer(AutomationSendPending, -Integer(delay))
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
	global AutomationKey, AutomationCaptureDone

	; Ignore standalone modifier presses so the next usable key can be recorded.
	if (vk = 16 || vk = 17 || vk = 18 || vk = 91 || vk = 92)
		return

	keyName := GetKeyName(Format("vk{:02X}sc{:03X}", vk, sc))
	if (keyName != "") {
		AutomationKey.Value := "{" keyName "}"
		AutomationCaptureDone := true
		ih.Stop()
	}
}

AutomationCaptureEnded(ih) {
	global AutomationCaptureStatus, AutomationCaptureDone
	if (!AutomationCaptureDone)
		AutomationCaptureStatus.Value := "No key recorded; timed out."
}

AutomationSendPending() {
	global AutomationPendingKey
	SendInput(AutomationPendingKey)
}

AutomationGuiClose(*) {
	global AutomationGui
	AutomationGui.Hide()
}

; Call ShowDelayedClickForm() to record a mouse click and replay it after a delay.
ShowDelayedClickForm(Macro) {
	global AutomationClickGui, AutomationClickDelay, AutomationClickStatus
	global AutomationClickCaptured

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
	SetTimer(AutomationSendPendingClick, -Integer(delay))
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

