#Requires AutoHotkey v2.0

; *********************** IO Functions ********************************
/**
 * @description
 * Toggles the layer selection GUI while the specified key is held down.
 * @param {(String)} KeyName
 * The {@link https://www.autohotkey.com/docs/v2/KeyList.htm|name of a key} used for selection.  
 * Controller buttons can be used but none of the others controller inputs.  
 * A virtual code such as `vkFF` can be used for {@link https://www.autohotkey.com/docs/v2/KeyList.htm#SpecialKeys|special cases}.
 */
ToggleLayerSelection(Keyname)
{
   ; variables
   global mode
   global selectionGui
   
   ; enable layer selection mode
   mode := 1 
   selectionGui.Show()

   ; disable layer selection mode on Keyname release. AutoHotkey's hook counts only a key pressed on a
   ; keyboard as physically held, not one another program sends (an on-screen keyboard, a remapper),
   ; so wait for the physical release, then for the logical one, as the PowerShell version does.
   KeyWait(Keyname)
   KeyWait(Keyname, "L")
   mode := 0
   selectionGui.Hide()
}

/**
 * @description
 * Activates a macro or selects a layer depending on the current mode.
 * @param {(String)} Keyname
 * The {@link https://www.autohotkey.com/docs/v2/KeyList.htm|name of a key} used for a macro button.  
 * Controller buttons can be used but none of the others controller inputs.  
 * A virtual code such as `vkFF` can be used for {@link https://www.autohotkey.com/docs/v2/KeyList.htm#SpecialKeys|special cases}.
 */
ActivateOrSelectMacro(Keyname)
{
   ; variables
   global mode
   global selectionGui
   if (selectionGui.layout.IsNoLayers())
      return

   value := selectionGui.layout.GetKeyIndex(Keyname)

   ; if Layer Selection mode is enabled
   if (mode == 1) {
      mode := 2
      selectionGui.SelectLayer(value)
      mode := 1
   }
   ; if Macro mode is enabled
   else if (mode == 0) {
      ; get the selected layer
      try {
         selectedLayer := selectionGui.GetSelectedLayer()
         ; if not a blank macro
         if (selectionGui.layout.layers[selectedLayer].macros[value])
            ; function of key on the selected layer
            RunMacroAction(selectionGui.layout.layers[selectedLayer].macros[value])
      } catch Error as err {
         if (err.message != "Invalid index.")
            throw err
      }
   }
   ; do nothing if changing layer
   ; wait for key release to prevent stuck keys
   KeyWait(Keyname)
}

/**
 * @description
 * Runs a macro's command: what a macro key and a click on the overlay do. (A hotkey or hotstring of
 * config.json calls its action itself, through ConfigRunner in config.ahk, and writes no line: unlike
 * the PowerShell version, whose hotkeys go through the same function as its keys.)
 * When the end-to-end test started this macropad (OMB_E2E and OMB_E2E_DIR set), it
 * also writes to the test's command log a line when the command starts, and one when it has returned
 * or thrown: "start <command>", "done <command>", "failed <command>: <message>". A thrown error goes on
 * as before. Without OMB_E2E the command is called as it always was, and nothing is written.
 * The PowerShell version writes the same lines (Invoke-EngineMacro in powershell\lib\Engine.ps1).
 * @param {Macro} M
 * The macro to run.
 */
RunMacroAction(M) {
   path := CommandLogPath()
   if (path = "") {
      M.action()
      return
   }
   name := CommandLogName(M)
   CommandLogWrite(path, "start " name)
   try M.action()
   catch Any as err {
      CommandLogWrite(path, "failed " name ": " CommandLogMessage(err))
      throw err
   }
   CommandLogWrite(path, "done " name)
}

/**
 * @description
 * The end-to-end test's command log: OMB_E2E_DIR\commands.log when the test started this macropad
 * (OMB_E2E and OMB_E2E_DIR both set), else "". Read once, at the first macro.
 */
CommandLogPath() {
   static path := (EnvGet("OMB_E2E") != "" && EnvGet("OMB_E2E_DIR") != "") ? EnvGet("OMB_E2E_DIR") "\commands.log" : ""
   return path
}

/**
 * @description
 * The name a line of the command log gives a macro's command: the name of the function of its action,
 * else the macro's name.
 * @param {Macro} M
 * The macro.
 */
CommandLogName(M) {
   try {
      if (M.action is Func && M.action.Name != "")
         return M.action.Name
   }
   try return M.name
   return ""
}

/**
 * @description
 * What a thrown value says, on one line.
 * @param Err
 * The thrown value: an Error, or anything else a script may throw.
 */
CommandLogMessage(Err) {
   text := ""
   try text := (Err is Error) ? Err.Message : String(Err)
   return RegExReplace(text, "\s*\R\s*", " ")
}

/**
 * @description
 * Appends one line to the command log, in UTF-8 without a byte order mark, ended by a bare line feed.
 * FileOpen shares reading and writing, as the test's reader does, so neither is refused when both have
 * the file at the same moment. Best effort: a line that cannot be written is dropped, and never stops
 * or breaks the command.
 * @param {String} Path
 * The command log.
 * @param {String} Line
 * The line, without its line feed.
 */
CommandLogWrite(Path, Line) {
   try {
      f := FileOpen(Path, "a", "UTF-8-RAW")
      f.Write(Line "`n")
      f.Close()
   }
}

/**
 * @description
 * A function that does nothing.
 * @param {(String)} Keyname
 * The {@link https://www.autohotkey.com/docs/v2/KeyList.htm|name of a key} used for a macro button.  
 * Controller buttons can be used but none of the others controller inputs.  
 * A virtual code such as `vkFF` can be used for {@link https://www.autohotkey.com/docs/v2/KeyList.htm#SpecialKeys|special cases}.
 */
DoNothing(Keyname) {
   return
}

/**
 * @description Handles mouse events for tooltips and clicks on the GUI elements.
 * @param wParam 
 * @param lParam 
 * @param msg
 * @param hwnd 
 */
OnMouseEvent(wParam, lParam, msg, hwnd) {
   static TME_LEAVE := 0x2
   global selectionGui
   if (selectionGui.layout.IsNoLayers())
      return
   if (msg = WM_LBUTTONDOWN) {
      ; Get the hwnd of the control the mouse is over
      MouseGetPos(, , , &ctrl, 2)
      ; See if its a label
      Loop selectionGui.labels.Length {
         if (selectionGui.labels[A_Index].Hwnd = ctrl) {
            if (selectionGui.layout.macroIcons) {
               if (A_Index <= selectionGui.layout.layers.Length && selectionGui.layout.layers[A_Index])
                  ; Select the layer
                  if (selectionGui.layout.layers[A_Index])
                     selectionGui.SelectLayer(A_Index)
               return
            }
            ; Activate the macro
            RunMacroAction(selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros[A_Index])
         }
      }
      ; See if its a button
      Loop selectionGui.buttons.Length {
         if (selectionGui.buttons[A_Index].Hwnd = ctrl && selectionGui.layout.layers.Length >= A_Index) {
            if ((selectionGui.layout.iconAction || !selectionGui.layout.showLabels) || (selectionGui.layout.macroIcons || !selectionGui.layout.showLabels)) { 
               if (A_Index <= selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros.Length && selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros[A_Index])
                  RunMacroAction(selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros[A_Index])
               return
            }
            ; Select the layer
            if (selectionGui.layout.layers[A_Index])
               selectionGui.SelectLayer(A_Index)
            return
         }
      }
   }
   if msg = WM_MOUSEMOVE {
      ; Start tracking so we know when the mouse leaves the window
      TRACKMOUSEEVENT := Buffer(8 + A_PtrSize * 2)
      NumPut('UInt', TRACKMOUSEEVENT.Size,
            'UInt', TME_LEAVE,
            'Ptr', hwnd,
            'Ptr', 10, TRACKMOUSEEVENT)
      DllCall('TrackMouseEvent', 'Ptr', TRACKMOUSEEVENT)
      ; Get the hwnd of the control the mouse is over
      MouseGetPos(, , , &ctrl, 2)
      ; See if its a label
      Loop selectionGui.labels.Length {
         ; Set the tooltip to the macro description
         if (selectionGui.labels[A_Index].Hwnd = ctrl) {
            if (selectionGui.layout.macroIcons) {
               if (A_Index <= selectionGui.layout.layers.Length && selectionGui.layout.layers[A_Index])
                  ToolTip(selectionGui.layout.layers[A_Index].title, , , 1)
                  return
            }
            ToolTip(selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros[A_Index].name "`n" selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros[A_Index].description, , , 1)
            return
         }
      }
      ; See if its a button
      Loop selectionGui.buttons.Length {
         if (selectionGui.buttons[A_Index].Hwnd = ctrl && selectionGui.layout.keys.Length >= A_Index) {
            if ((selectionGui.layout.iconAction || !selectionGui.layout.showLabels) || (selectionGui.layout.macroIcons || !selectionGui.layout.showLabels)) {
               if (A_Index <= selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros.Length && selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros[A_Index])
                  ToolTip(selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros[A_Index].name "`n" selectionGui.layout.layers[selectionGui.GetSelectedLayer()].macros[A_Index].description, , , 1)
               return
            }
            ; Set the tooltip to the layer title
            if (selectionGui.layout.layers.Length >= A_Index && selectionGui.layout.layers[A_Index])
               ToolTip(selectionGui.layout.layers[A_Index].title, , , 1)
               return
         }
      }
   } 
   if msg = WM_MOUSELEAVE {
      ToolTip( , 0, 0, 1)
   }
}