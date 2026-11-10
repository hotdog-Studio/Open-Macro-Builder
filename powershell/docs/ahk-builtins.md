# AutoHotkey built-ins in the PowerShell macropad

AutoHotkey's built-in functions are thin wrappers over Win32, so nearly all of them can be ported. They fall into four groups:

1. **Native.** PowerShell or .NET already does it (`Run`, `MsgBox`, `Gui`, timers, files, the registry, regular expressions, the clipboard, monitors). No code was needed.
2. **One Win32 call each.** Window queries and actions, styles, messages, the mouse position, pixel colours and the volume.
3. **AutoHotkey internals rebuilt in C#.** WinTitle matching, `Send` syntax, the hotkey syntax (`~ * < > up`, `a & b`), `#HotIfWinActive`, hotstrings, and image and pixel search.
4. **Not ported.** Each has its reason in the table.

Port functions use PowerShell Verb-Noun names, because AutoHotkey names would collide with command functions (`Shutdown`) and built-in aliases (`sleep`). The ports live in `lib/Send.ps1`, `lib/WinTitle.ps1`, `lib/WindowOps.ps1`, `lib/Hotkeys.ps1`, `lib/Screen.ps1`, `lib/Sound.ps1`, `lib/Pump.ps1` and `lib/Input.ps1`. `tests/BuiltinMap.Tests.ps1` checks this table against the code.

| AutoHotkey | PowerShell | Kind | Notes |
| --- | --- | --- | --- |
| `Send` / `SendInput` / `SendText` / `SendEvent` | `Send-Ahk`, `Send-Text` | port | Every send uses SendInput. Held modifiers are released first and not restored afterwards. |
| `Hotkey` | `Hotkey` | port | Defined by `Get-MacropadHotkeys` in `config.ps1`. |
| `Hotstring` | `Hotstring` | port | Defined by `Get-MacropadHotkeys` in `config.ps1`. |
| `#HotIfWinActive` / `#HotIfWinNotActive` | `Hotkey`, `Hotstring` | port | The `-IfWinActive` and `-IfWinNotActive` parameters. |
| `KeyWait` | `Wait-Key` | port | Waits pump messages, so the macropad stays responsive. |
| `GetKeyState` | `Test-KeyPressed`, `Test-KeyToggled` | port | Physical state and toggle state. |
| `SetCapsLockState` / `SetNumLockState` / `SetScrollLockState` | `Set-LockKeyState` | port | Taps the key only when the state differs. |
| `Sleep` | `Wait-Pump` | port | Pumps messages while waiting; throws when the macropad is exiting. |
| `WinExist` / `WinGetList` | `Find-Window` | port | `-All` returns every match. |
| `WinActive` | `Test-WindowActive` | port | |
| `WinGetTitle` / `WinGetClass` / `WinGetPID` / `WinGetProcessName` / `WinGetProcessPath` / `WinGetID` | `Get-WindowInfo` | port | One object with every field. |
| `WinActivate` / `WinActivateBottom` | `Switch-Window` | port | `-Bottom` picks the last match. |
| `WinWait` / `WinWaitActive` | `Wait-Window` | port | `-Active` for WinWaitActive. |
| `WinWaitClose` / `WinWaitNotActive` | `Wait-WindowClose` | port | `-NotActive` for WinWaitNotActive. |
| `WinClose` / `WinKill` | `Close-Window` | port | `-Force` for WinKill. |
| `WinMinimize` / `WinMaximize` / `WinRestore` / `WinHide` / `WinShow` | `Set-WindowState` | port | |
| `WinGetMinMax` | `Get-WindowState` | port | Returns Minimized, Maximized or Normal. |
| `WinMove` | `Move-Window` | port | Omitted values keep the current ones. |
| `WinGetPos` / `WinGetClientPos` / `ControlGetPos` | `Get-WindowRect` | port | `-Client` for the client area; screen coordinates. |
| `WinSetAlwaysOnTop` | `Set-WindowTopmost` | port | |
| `WinSetTransparent` / `WinSetTransColor` | `Set-WindowTransparency` | port | `-Alpha` and `-TransColor`; both -1 turns it off. |
| `WinGetStyle` / `WinGetExStyle` / `ControlGetStyle` / `ControlGetExStyle` | `Get-WindowStyle` | port | Pass a control handle for the Control versions. |
| `WinSetStyle` / `WinSetExStyle` / `ControlSetStyle` / `ControlSetExStyle` | `Set-WindowStyle` | port | Set, Add, Remove or Toggle. |
| `ControlGetHwnd` | `Find-Control` | port | By ClassNN or exact text. |
| `ControlGetText` / `ControlSetText` | `Get-ControlText`, `Set-ControlText` | port | |
| `ControlClick` | `Invoke-ControlClick` | port | Posts the button messages to the control. |
| `ControlSend` / `ControlSendText` | `Send-ControlKeys` | port | Modifiers do not change the target's modifier state, as in AutoHotkey. |
| `SendMessage` / `PostMessage` | `Send-WindowMessage` | port | `-Post` for PostMessage. |
| `Click` | `Send-Click` | port | |
| `MouseMove` | `Move-Mouse` | port | |
| `MouseGetPos` | `Get-MousePosition` | port | |
| `CoordMode` | `ConvertTo-ScreenPoint` | port | All coordinates are screen coordinates; this converts client coordinates. |
| `PixelGetColor` | `Get-PixelColor` | port | |
| `PixelSearch` | `Find-Pixel` | port | |
| `ImageSearch` | `Find-Image` | port | |
| `ToolTip` | `Show-ToolTip`, `Hide-ToolTip` | port | Up to 20 tooltips by id; they never take focus. |
| `SoundGetVolume` / `SoundSetVolume` | `Get-SoundVolume`, `Set-SoundVolume` | port | Default playback device only. |
| `SoundGetMute` / `SoundSetMute` | `Get-SoundMute`, `Set-SoundMute`, `Switch-SoundMute` | port | Default playback device only. |
| `Run` / `RunWait` | `Start-Process` | native | `-Wait` for RunWait. |
| `MsgBox` | `[System.Windows.Forms.MessageBox]::Show` | native | |
| `InputBox` | `[Microsoft.VisualBasic.Interaction]::InputBox` | native | Load `Microsoft.VisualBasic` first. |
| `Gui` | WinForms | native | |
| `Menu` / `A_TrayMenu` | `NotifyIcon` and `ContextMenuStrip` | native | See `lib/Tray.ps1`. |
| `TrayTip` | `NotifyIcon.ShowBalloonTip` | native | |
| `SetTimer` | `System.Windows.Forms.Timer` | native | Handlers take `param($sender, $e)` and read `Tag`. |
| `OnMessage` | `NativeWindow.WndProc` | native | See `Macropad.HotkeyWindow` in `lib/Native.ps1`. |
| `DllCall` | `Add-Type` with `DllImport` | native | |
| `FileExist` / `DirExist` | `Test-Path` | native | |
| `FileRead` / `FileAppend` | `Get-Content` / `Add-Content` | native | |
| `RegRead` / `RegWrite` | `Get-ItemProperty` / `Set-ItemProperty` | native | |
| `RegExMatch` / `RegExReplace` | `-match` / `-replace` / `[regex]` | native | .NET syntax; no PCRE callouts. |
| `Format` | `-f` | native | |
| `StrSplit` | `-split` | native | |
| `A_Clipboard` | `Get-Clipboard` / `Set-Clipboard` | native | |
| `A_TickCount` | `[Environment]::TickCount` | native | |
| `A_ScriptDir` | `$PSScriptRoot` | native | |
| `A_Index` | a `for` loop counter | native | |
| `A_PtrSize` | `[IntPtr]::Size` | native | |
| `A_ThisFunc` | `$MyInvocation.MyCommand.Name` | native | |
| `MonitorGet` / `MonitorGetWorkArea` | `[System.Windows.Forms.Screen]::AllScreens` | native | |
| `SysGet` | `[System.Windows.Forms.SystemInformation]` | native | |
| `ProcessExist` / `ProcessClose` | `Get-Process` / `Stop-Process` | native | |
| `EnvGet` | `$env:NAME` | native | |
| `ComObject` | `New-Object -ComObject` | native | |
| `IL_Create` / `IL_Destroy` | not needed | native | A `PictureBox` shows the PNGs directly. |
| `Shutdown` | `shutdown.exe` / `[Macropad.Native]::SetSuspendState` | native | See `commands/power.ps1`. |
| `ExitApp` / `Reload` | `[System.Windows.Forms.Application]::Exit()` / tray Reload | native | |
| `SendPlay` | | not ported | Journal hooks have not worked since Windows Vista. |
| `SendMode` / `SetKeyDelay` | | not ported | Every send is one SendInput batch. |
| `SendLevel` | | not ported | The macropad ignores only its own tagged input. |
| `KeyHistory` | | not ported | A debugging aid with no use in the macropad. |
| `Critical` / `Thread` / `#MaxThreadsPerHotkey` | | not ported | One UI thread plus the macro guard (`Invoke-EngineMacro`) decide what runs. |
| `#HotIf` | | not ported | An expression cannot run inside the hook, which must decide at once. |
| `#HotIfWinExist` | | not ported | It would re-evaluate on every window created or destroyed. |
| `Input` / `InputHook` | | not ported | Possible on `Macropad.InputHook`, not planned. |
| `IniRead` / `IniWrite` | | not ported | Use JSON with `ConvertFrom-Json` instead. |
