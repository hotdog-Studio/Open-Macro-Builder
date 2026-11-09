# Layered Macropad (PowerShell)

## How the Fn key is detected

The Fn key (ScrollLock) is handled by a low-level keyboard hook (`WH_KEYBOARD_LL`), not by `RegisterHotKey`.

`RegisterHotKey` was tried first (see `tools/spike-hotkeys.ps1` history). It fired once per press with `MOD_NOREPEAT`, and polling `GetAsyncKeyState` caught the release. But Windows still toggled the Scroll Lock state on every Fn press, because a registered hotkey does not stop the key from reaching the keyboard state. The AutoHotkey version never toggled it, because its hook swallows the key.

The hook in `lib/Native.ps1` (`Macropad.KeyHook`) swallows ScrollLock and posts its down and up transitions to the hotkey window, which raises `FnDown` and `FnUp`. The hook runs on its own thread with its own message loop. A macro that keeps the PowerShell thread busy for seconds therefore cannot stall keyboard input for the rest of the system, and Windows never removes the hook for timing out.

The twelve macro keys (F13 to F24) still use `RegisterHotKey` with `MOD_NOREPEAT`.
