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

Errors from macros show as a tray balloon and are appended to `%TEMP%\LayeredMacropad.log`. Startup errors, such as a config naming a command that does not exist, show a message box and stop the program.

## Configure

Edit `config.ps1`. It mirrors `../ahk/config.ahk`: `Key`, `Icon`, `Layer`, `Macro` and `Layout` take the same arguments in the same order, and `''` skips a layer or a macro slot. Command functions live in `commands/` and take the macro as their only parameter. Key chords are written as key names joined by `+`, for example `Send-Chord 'Ctrl+Shift+t'`. The key names are listed in `lib/Input.ps1`.

## Hotkeys and hotstrings

Besides the macropad keys, `config.ps1` can define ordinary AutoHotkey-style hotkeys. Add a `Get-MacropadHotkeys` function that returns `Hotkey` definitions. Each one takes an AutoHotkey hotkey spec and a command function name or a scriptblock:

```powershell
function Get-MacropadHotkeys {
    @(
        (Hotkey '^!e' 'OpenFileExplorer'),              # Ctrl+Alt+E
        (Hotkey '#n' { param($m) Start-Process notepad }),
        (Hotkey 'XButton1 & WheelUp' 'NextDesktop')
    )
}
```

The spec syntax is AutoHotkey's: `^ ! + #` for Ctrl, Alt, Shift and Win, `<` / `>` for the left or right one, `~` to let the key through as well, `*` to ignore extra modifiers, a trailing ` up` to fire on release, and `A & B` for a custom combination. A hotkey on a macropad key (F13 to F24 or the Fn key) stops startup with an error.

Hotkeys run through the same guard as macros: while one macro or hotkey is running, further ones are dropped. Their errors are reported in the tray like macro errors. The hook that catches them ignores everything the macropad sends itself.

Hotstrings go in the same list. `Hotstring` takes an AutoHotkey hotstring spec and the replacement text:

```powershell
function Get-MacropadHotkeys {
    @(
        (Hotstring '::btw' 'by the way'),               # after an end character such as space or .
        (Hotstring ':*:@@' 'hello@example.com'),        # * fires without an end character
        (Hotstring ':X:now' { param($m) Send-Text (Get-Date -Format t) })   # X runs a macro instead
    )
}
```

Supported options are `*` (no end character needed), `?` (fire inside words), `C` (case-sensitive), `C1` (match any case, keep the replacement as written), `B0` (keep the typed abbreviation), `O` (leave out the end character) and `X` (execute). Without `C` or `C1` the replacement follows the case you typed: `BTW` gives `BY THE WAY`, `Btw` gives `By the way`. Clicking, switching windows, the arrow keys and any Ctrl, Alt or Win combination start the abbreviation over.

Both `Hotkey` and `Hotstring` accept `-IfWinActive` or `-IfWinNotActive` with a WinTitle (for example `'ahk_exe Code.exe'`), like AutoHotkey's `#HotIfWinActive`. A window-specific variant wins over a global one with the same keys.

## Test

From `macropad_ahk`:

```
powershell -NoProfile -File powershell\tests\run.ps1
powershell -NoProfile -File powershell\tests\run.ps1 -ExcludeTag Integration
```

The Integration tests open and close Character Map and send a real ScrollLock press, which the Fn hook swallows. Exclude them when you do not want windows or keys touched.

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
