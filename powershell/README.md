# Layered Macropad (PowerShell)

A Windows PowerShell 5.1 port of the AutoHotkey macropad in `../ahk`. It uses the same images (`../img`), the same config shape and the same command names.

Hold the Fn key (ScrollLock) to show the overlay, and press a macro key (F13 to F24) while holding it to pick that key's layer. Release Fn to hide the overlay. Without Fn, a macro key runs the macro in its slot of the selected layer.

## Requirements

- Windows PowerShell 5.1 (`powershell.exe`). PowerShell 7 is not needed.
- Nothing else at runtime. WinForms and System.Drawing come with .NET Framework.
- For the tests only: Pester 5.5 or newer, installed for the current user:

```powershell
Install-Module Pester -MinimumVersion 5.5.0 -Scope CurrentUser -Force -SkipPublisherCheck
```

## Run

Close the AutoHotkey macropad first (tray icon, then Exit). Its keyboard hook swallows F13 to F24 and ScrollLock, so the two versions cannot run at the same time.

```
wscript powershell\launch.vbs
```

`launch.vbs` starts `main.ps1` with no console window. A tray icon appears with Reload and Exit. Launching again replaces the running instance.

Errors from macros show as a tray balloon and are appended to `%TEMP%\LayeredMacropad.log`. Once that file passes 1 MB it becomes `LayeredMacropad.log.old` and a new one starts. Startup errors, such as a config naming a command that does not exist, show a message box and stop the program.

## Configure

The layout is a JSON file that the AutoHotkey version reads too, so both stay in step: the file named by `$env:OMB_CONFIG`, else your own `../local/config.json` (ignored by git), else the example `../config.json`. `config.ps1` here and `../ahk/config.ahk` only load it. A test checks that both versions build the same layout from the example and from your own file.

Your own commands go in `../local/powershell/commands`, which is loaded after `commands/`, and their tests in `../local/powershell/tests`. The root readme describes the `local` folder.

```json
{
  "fn": { "key": "ScrollLock", "row": 4, "col": 1, "width": 2 },
  "keys": [ { "key": "F13", "row": 1, "col": 1 }, { "key": "F22", "row": 1, "col": 4, "height": 2 } ],
  "layers": [
    {
      "title": "Examples",
      "icon": "default_commands",
      "macros": [
        { "action": "ExampleOpenWebsite", "name": "Website", "description": "Open example.com" },
        null
      ]
    },
    null,
    { "title": "Old layer", "icon": "default_commands", "disabled": true, "macros": [] }
  ],
  "default": 1,
  "showFn": " ",
  "showMacroMarkers": true,
  "showLabels": true,
  "useMacroIcons": false,
  "iconAction": "Layer",
  "hotkeys": [],
  "hotstrings": []
}
```

- `keys` are the macro keys; `width` and `height` default to 1. Layers and macros are matched to keys by position.
- `null` leaves a layer or macro slot empty. `"disabled": true` keeps a layer in the file without giving it a key.
- `icon` names a folder in `../img`. A macro can have its own `icon`, used with `useMacroIcons`.
- `action` is the name of a command function in `commands/` or `../local/powershell/commands`. Command functions take the macro as their only parameter. A name that matches no function stops startup with every missing name listed.
- `default` is the layer selected at startup, counted from 1. `showFn` is the text above the Fn key (`" "` for none, `true` for its name).

Key chords in commands are key names joined by `+`, for example `Send-Chord 'Ctrl+Shift+t'`. The key names are listed in `lib/Input.ps1`.

## Hotkeys and hotstrings

Besides the macropad keys, `config.json` can define ordinary AutoHotkey-style hotkeys and hotstrings. Both versions register them.

```json
"hotkeys": [
  { "hotkey": "^!e", "action": "OpenFileExplorer" },
  { "hotkey": "XButton1 & WheelUp", "action": "NextDesktop" },
  { "hotkey": "^+d", "action": "VsCodeDebug", "ifWinActive": "ahk_exe Code.exe" }
],
"hotstrings": [
  { "hotstring": "::btw", "replacement": "by the way" },
  { "hotstring": ":*:@@", "replacement": "hello@example.com" },
  { "hotstring": ":X:now", "action": "SomeCommand" }
]
```

The hotkey syntax is AutoHotkey's: `^ ! + #` for Ctrl, Alt, Shift and Win, `<` / `>` for the left or right one, `~` to let the key through as well, `*` to ignore extra modifiers, a trailing ` up` to fire on release, and `A & B` for a custom combination. A hotkey on a macropad key (F13 to F24 or the Fn key) stops startup with an error.

Hotkeys run through the same guard as macros: while one macro or hotkey is running, further ones are dropped. Their errors are reported in the tray like macro errors. The hook that catches them ignores everything the macropad sends itself. The hook is only installed when the config has hotkeys or hotstrings.

Hotstring options are `*` (no end character needed), `?` (fire inside words), `C` (case-sensitive), `C1` (match any case, keep the replacement as written), `B0` (keep the typed abbreviation), `O` (leave out the end character) and `X` (run `action` instead of typing a replacement; an `action` needs `X`). Without `C` or `C1` the replacement follows the case you typed: `BTW` gives `BY THE WAY`, `Btw` gives `By the way`. Clicking, switching windows, the arrow keys and any Ctrl, Alt or Win combination start the abbreviation over.

`ifWinActive` or `ifWinNotActive` take a WinTitle (for example `"ahk_exe Code.exe"`), like AutoHotkey's `#HotIfWinActive`. A window-specific variant wins over a global one with the same keys.

In PowerShell code, the same definitions can be built with `Hotkey` and `Hotstring` from `lib/Hotkeys.ps1`, which also accept a scriptblock as the action.

## AutoHotkey built-ins

[docs/ahk-builtins.md](docs/ahk-builtins.md) maps every AutoHotkey built-in to its PowerShell equivalent: a port in this folder, something PowerShell or .NET already does, or a reason it is not ported. Commands can use the ports directly:

| File | Ports |
| --- | --- |
| `lib/Send.ps1` | `Send-Ahk`, `Send-Text`, `Wait-Key`, `Test-KeyToggled`, `Set-LockKeyState` |
| `lib/Input.ps1` | `Send-Chord`, `Send-Key`, `Send-Click`, `Test-KeyPressed` |
| `lib/Pump.ps1` | `Wait-Pump` (use it instead of `Start-Sleep` in commands) |
| `lib/WinTitle.ps1` | `Find-Window`, `Test-WindowActive`, `Get-WindowInfo` |
| `lib/WindowOps.ps1` | window actions, waits, styles, controls and messages |
| `lib/Hotkeys.ps1` | `Hotkey`, `Hotstring` |
| `lib/Screen.ps1` | pixels, image search, the mouse and tooltips |
| `lib/Sound.ps1` | volume and mute |

Window functions take an AutoHotkey WinTitle such as `'ahk_exe chrome.exe'` or `'Untitled - Notepad ahk_class Notepad'`.

## Test

From `macropad_ahk`:

```
powershell -NoProfile -File powershell\tests\run.ps1
powershell -NoProfile -File powershell\tests\run.ps1 -ExcludeTag Integration
```

The Integration tests send real keys and clicks, open and close Character Map, and run AutoHotkey check scripts. They type only into their own test windows, and the Fn hook swallows their ScrollLock press. Exclude them when you do not want keys sent or other programs started. The unit tests still flash a few of their own forms while they run: the overlay, tooltips, the delayed key and click forms, and the window tests' target windows.

`tools/spike-hotkeys.ps1` and `tools/preview-overlay.ps1` are manual checks for the hotkeys and the overlay.

## Start with Windows

The startup shortcut `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LayeredMacropad.lnk` starts one version at login. The AutoHotkey and PowerShell versions cannot run at the same time, so point it at only one of them.

To switch to the PowerShell version, retarget the shortcut to `wscript.exe` with `launch.vbs` as its argument:

```powershell
$lnk = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\LayeredMacropad.lnk"
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = 'C:\Windows\System32\wscript.exe'
$s.Arguments = '"<repo>\macropad_ahk\powershell\launch.vbs"'
$s.WorkingDirectory = '<repo>\macropad_ahk\powershell'
$s.Save()
```

To switch back, set `TargetPath` to `<repo>\macropad_ahk\ahk\main.ahk`, `Arguments` to `''` and `WorkingDirectory` to `<repo>\macropad_ahk\ahk`. Replace `<repo>` with the folder that holds this repository.

## How the Fn key is detected

The Fn key (ScrollLock) is handled by a low-level keyboard hook (`WH_KEYBOARD_LL`), not by `RegisterHotKey`.

`RegisterHotKey` was tried first (see `tools/spike-hotkeys.ps1` history). It fired once per press with `MOD_NOREPEAT`, and polling `GetAsyncKeyState` caught the release. But Windows still toggled the Scroll Lock state on every Fn press, because a registered hotkey does not stop the key from reaching the keyboard state. The AutoHotkey version never toggled it, because its hook swallows the key.

The hook in `lib/Native.ps1` (`Macropad.KeyHook`) swallows ScrollLock and posts its down and up transitions to the hotkey window, which raises `FnDown` and `FnUp`. The hook runs on its own thread with its own message loop. A macro that keeps the PowerShell thread busy for seconds therefore cannot stall keyboard input for the rest of the system, and Windows never removes the hook for timing out.

The twelve macro keys (F13 to F24) still use `RegisterHotKey` with `MOD_NOREPEAT`.

## Differences from the AutoHotkey version

- The overlay never takes focus, so clicking it leaves keys going to the app you were in.
- Keys are sent as chords (`'LWin+Left'`) instead of AutoHotkey `Send` syntax.
- `VsCodeRestartDebugging`, `VsCodePauseDebugging` and `VsCodePeekImplementations` send the F-key the AutoHotkey version meant to send. The AutoHotkey source typed the letters because of missing braces.
- `Restart` uses `shutdown /r /t 1`.
- The fluent `Layout` methods (`AddLayer`, `RemoveLayer`, `ShowLabel` and so on) are not ported.
