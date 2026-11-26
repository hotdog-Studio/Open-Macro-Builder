# Changelog

What changed in each version, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are `MAJOR.MINOR.PATCH`. `PATCH` counts releases, and every green build of `develop` is one, so a patch release can add a feature or remove a command, and its entry says so. [docs/releasing.md](docs/releasing.md) has the scheme.

## Unreleased

### Fixed

- Configurator: **Update** in the update dialog is off until the dialog has checked your layout against the new scripts, so it can no longer be pressed before the warning about commands the update takes away could show. It says "Checking your layout against the new scripts…" meanwhile, and when the new scripts cannot be read it says so, and to open the folder again to try again, and updates nothing, where it used to show the plan without the warning and without a word.
- Configurator: the warning about commands the update takes away no longer sends you to the changelog to keep a command. It says to copy the command's text before you update and add it to a file of your own afterwards (**Commands** tab, **New file**), because until the update the shared file still defines the name and AutoHotkey stops on a name defined twice; after the update it says to write the commands into a file of your own, in place of "keep the commands in `local/`".
- Configurator: when the comparison of what the update took away with your layout fails after an update, the dialog says that, and to open the folder again before reloading the macropad. It used to say the command lists could not be read again, which was not what had failed.
- Configurator: the Commands tab's **Delete this file** no longer says the keys "would stop working". It says the macropad will not start while the layout runs a command that only this file defines, and names the command with the key, hotkey or hotstring that runs it, and what to take out of the layout first (or to keep the command in another file). A parked layer is left out, as the macropad never loads it.
- Configurator: **New command** refuses a name AutoHotkey already uses: a word of its language such as `Loop` or `Return`, or one of its own functions and classes such as `Send`, `Run` or `Map`, whatever the case and in a PowerShell file too (the macropad's commands have the same name in both versions). Such a command used to hide AutoHotkey's own function for every other command, or keep the macropad from starting. It also drops spaces typed before or after the name.
- Configurator: the syntax check of a command file no longer says "No syntax errors found" for a file it could not read (deleted since the save, or held open by another program). It says the check could not run, and gives PowerShell's reason in a line of its own, as it does when PowerShell or AutoHotkey cannot be started or the check writes more than the app can read; before, it showed that as the raw error, or as a check that took too long.

## 1.0.6 - 2026-11-25

### Added

- Configurator: AutoHotkey's own functions, such as `Send`, `Run` and `WinActivate`, have docs in the Commands tab too. Hovering one in an AutoHotkey file shows what it does, what to put in each parameter, examples to paste, its page in AutoHotkey's documentation, and what the PowerShell version uses instead. The right panel lists them under **AutoHotkey's own functions**, in groups such as Keys and mouse and Windows, after the folder's own; a function of yours with the same name comes first, as it does when the macropad runs. The functions are the ones a macropad uses, written for this project and carried inside the app, so every folder gets them; the last line of the list points to autohotkey.com for the rest.
- Configurator: a folder whose scripts are older than the app's offers an update. A bar says from which version to which, and **Review the update** shows what would be replaced, added and removed before anything is written. A file you changed is kept unless you tick it, and a ticked one leaves yours beside it as `<name>.before-update.bak`; a command file you deleted in the Commands tab stays deleted unless you tick it. Taking the `#Include` line of a command file out of `ahk/config.ahk` counts as a change to that file, so a command switched off that way stays off. Nothing under `local/` is changed, and a folder with a `.git` entry is left to git. The app records what it wrote in `omb-manifest.json` in the folder's root, and recognises the untouched files of 1.0.2 to 1.0.5 in folders from before that record. When your layout runs a command that no file would define after the update, on a key, a hotkey or a hotstring, the dialog names the command and where it runs before you press **Update** and again afterwards, and says the macropad will not start until you clear those keys in the **Macros** tab (and take such hotkeys and hotstrings out of the layout file) or keep the command in `local/`. Afterwards the desktop app offers **Reload the macropad** when the macropad is running, the layout runs no such command, and the command files could be read again after the update.

### Changed

- Desktop app: the program, its installer, its window and its taskbar button show the project logo, the hotdog on a key, as the web page does. The tray icon of both macropad versions stays the hotdog, so a running macropad and the configurator are told apart.

### Removed

- Both versions: `VsStudioSplitPanel`, and its key in the example layout. It pressed Ctrl+W+V, which Visual Studio binds to nothing unless you bound those keys yourself. A layout that still names it stops the macropad from starting, in both versions, and the configurator's update warns about it, before it replaces the file and again afterwards. To fix it, clear that key in the **Macros** tab and save, or keep the command in your own `local/` folder. Add it there after the update, not before, because until then the shared file still defines the same name and AutoHotkey stops on a name defined twice: in an AutoHotkey file in `local/ahk` (with an `#Include` line for the file in `local/ahk/commands.ahk`) `VsStudioSplitPanel(Macro) => Send("{Ctrl Down}{w Down}v{w Up}{Ctrl Up}")`, and in a PowerShell file in `local/powershell/commands` `function VsStudioSplitPanel { param($Macro) Send-Chord 'Ctrl+w+v' }`.
- Both versions: `SnapThirdsLeft` and `SnapThirdsRight`, and their keys in the example layout. They pressed Win+Alt+Left and Win+Alt+Right, which Windows binds to nothing and so snap to a third only where a tool you installed binds them. A layout that still names either stops the macropad from starting, in both versions, and the configurator's update warns about it, before it replaces the file and again afterwards. To fix it, clear those keys in the **Macros** tab and save, or keep the commands in your own `local/` folder. Add them there after the update, not before, because until then the shared files still define the same names and AutoHotkey stops on a name defined twice: in an AutoHotkey file in `local/ahk` (with an `#Include` line for the file in `local/ahk/commands.ahk`) `SnapThirdsLeft(Macro) => Send("{LWin Down}{LAlt Down}{Left}{LAlt Up}{LWin Up}")` and `SnapThirdsRight(Macro) => Send("{LWin Down}{LAlt Down}{Right}{LAlt Up}{LWin Up}")`, and in a PowerShell file in `local/powershell/commands` `function SnapThirdsLeft { param($Macro) Send-Chord 'LWin+LAlt+Left' }` and `function SnapThirdsRight { param($Macro) Send-Chord 'LWin+LAlt+Right' }`.

### Fixed

- PowerShell version: writing to the macropad's log (`%TEMP%\LayeredMacropad.log`) no longer fails while another program has the file open, such as a log viewer. A line that still cannot be written is dropped and never stops the macropad.
- AutoHotkey version: the overlay is shown without taking the focus, and a click on it does not take the focus either, as in the PowerShell version. The window you were typing in keeps the keyboard while the overlay is up, and is still the active window when the Fn key is let go.
- Both versions: `ChromeNewTabInGroup` opens a new tab inside the tab group of the active tab, right after it, as **New tab to the right** in the tab's right-click menu does, with the address bar of the new tab ready to type in as after Ctrl+T. It used to press Shift+Alt+T, which moves the focus to Chrome's toolbar. Chrome has no shortcut for a new tab in a group, so the command presses no key: it hands Chrome its own command for that menu item. It needs no extension and no change to Chrome's settings, and works in any display language. When the active tab is in no group, the new tab opens right after it, in no group. Like the Chrome commands above, it brings Chrome forward first and does nothing when Chrome does not come forward. It also does nothing while a Chrome bubble or dialog has the keyboard, in an installed app's window, a DevTools window or a popup window, or in a Chrome run as administrator when the macropad is not; when the active tab is pinned, the new tab opens after the pinned tabs. The example layout gives it no key.

## 1.0.5 - 2026-11-20

### Added

- Configurator: a **Get started** tab for people new to AutoHotkey and PowerShell. It says what to install, how to set up the keypad, and how to start, try and autostart the macropad, with the steps for the version ticked under **I run**. The start screen shows the same guide, and a folder that was just set up opens on it.
- PowerShell version: two helpers for your own commands. `ActivateOrOpenWindow` brings forward a window found by its title or class, such as a shell in Windows Terminal, steps through such windows on the next press, and starts the program when there is none; it never picks the macropad's own windows. `Show-MessageBox` shows a message box in front of the window you were using and waits until it is closed, like AutoHotkey's `MsgBox`.
- Both versions: `ActivateOrOpenApp`, a helper for your own commands that open an app whose window Windows shows in its app frame, such as Settings or Calculator. Such a window belongs to `ApplicationFrameHost.exe`, not to the app's own program, and its title is translated, so the helper finds it by the app's application id, which is the same in every display language. It brings the window forward, steps through the app's windows on the next press, and starts the app when it has none. In the PowerShell version `Get-AppWindow` lists those windows, and `Get-StartApps`, which comes with Windows, lists the id of every installed app. A program that has a window of its own, such as Notepad or Terminal on Windows 11, is not found this way, although it has an id too: for those use `ActivateOrOpen`, or in the PowerShell version also `ActivateOrOpenWindow`.
- Tests: an end-to-end test of both versions on a real desktop. `powershell\tests\run.ps1 -EndToEnd` starts the real macropad, the AutoHotkey version and then the PowerShell one, from a copy without your `local/`, presses the macro keys and checks what every command did. Each command is covered, conditional on something a PC may lack (such as a second monitor), or excluded with the reason (the power commands). `-Case` runs only some cases, `-Repeat` sets how often the Calculator series runs, and `-EndToEndCleanup` cleans up after a run that did not end itself. It needs AutoHotkey v2 and Python, and has the keyboard, the mouse and the screen for a few minutes ([docs/development.md](docs/development.md#the-end-to-end-test)).
- CI: a `Windows End-to-End` stage runs that test on every branch, on the Windows agent with a logged-in desktop (label `windows-desktop`, or the one in the `OMB_WINDOWS_DESKTOP_LABEL` global), and a build of `develop` releases only when it passed. The `Windows Tests` stage, the Pester suite, now runs on every branch too, not only on `develop`.
- Tests: new guards. The AutoHotkey version must load without an error, and without a warning about a variable that is never assigned (a misspelt function name is one) or code that can never run, and no script under `ahk` may set its own `#Warn` unless it sends its warnings to StdOut. Both versions must press the same keys for each command that only presses keys, and every key name a PowerShell command presses must exist. Every PowerShell help block, in the library and in every command file, is checked: its examples may call only the project's functions and what comes with Windows PowerShell, with whole parameter names; a function that returns a value needs `.OUTPUTS`; the first sentence must fit a row of the right panel. Every AutoHotkey command needs a doc block, and the tests of the power commands can never lock, sleep or switch off the PC that runs them. Many unit and browser tests came with the fixes below.
- Developer documentation: a photosensitivity warning in the readme, `docs/development.md` and `powershell/README.md`. The Pester suite, the end-to-end test and the desktop-app tests open, move and close windows in quick succession, which makes the screen flash; `docs/development.md` says which suite does what.

### Changed

- Configurator: the right-hand panel on Pad shape, Layers and Macros grows to fit the overlay preview, so the preview shows whole without a sideways scrollbar of its own. The panel stops at half the window, and a preview wider than that scrolls as before.
- Configurator: messages, the bar that says `config.json` changed on disk and the update's bar float over the top of the editor and no longer push it down. When more than one shows, they stack without covering each other, and a click beside them reaches the editor. Notices are blue and refused actions amber, and both leave by themselves after a few seconds. Failures are red and stay until dismissed, and so do the notices shown when a folder is opened.
- Configurator: the New command file dialog and the `local/config.json` prompt no longer mention git, because a folder the configurator sets up is a plain copy and not a clone. The comment at the top of a new `local/ahk/commands.ahk` changed with them.
- Desktop app: the two links in the Get started guide, to the AutoHotkey download page and to the contributing guide, open in the default browser. Every other address is still refused.
- Configurator: in a window narrower than 1440 px the header leaves out the path of the layout file, so the five tabs and the buttons stay on one row at the desktop app's default size.
- Both versions: `EnsureActiveOrOpen` returns whether a window of the program is the active window at the end. It is false when no window appeared within 5 seconds or Windows kept the window from the front, so a command can check it before it sends keys. `EnsureActiveOrOpenChrome` returns the same answer for Chrome. In the AutoHotkey version the `Args` of `EnsureActiveOrOpen` can be left out; a call with two arguments used to stop the script from loading.
- AutoHotkey version: `ActivateOrOpen`, `Open`, `EnsureActiveOrOpen`, `RunPythonScript`, `RunPowerShellScript` and `RunBatchScript` start the program themselves instead of through `cmd`'s `start`, and put `Args` on its command line as given, where they used to wrap it in double quotes as one argument. Several arguments now arrive apart, but one argument with spaces in it needs its own double quotes, as on any command line.
- PowerShell version: a symbol in a key name for `Send-Chord` or `Send-Ahk` (`'`, `` ` ``, `\`, `;` and the others) presses the key that types that character on the keyboard layout of the active window, so on a UK keyboard `Send-Chord "'"` types `'`, not `#`. Where the layout types the character only with Shift or AltGr, the key of a US keyboard is pressed, as before. Any other single character, such as `#` on a UK keyboard, can be named too, and the delayed-key form records such a key by that character. Keys go out with the scan code they have on the layout of the window that gets them, `Send-ControlKeys` included.

### Removed

- AutoHotkey version: `EncodeInteger`, from `helper.ahk`. Nothing called it, and it cut a 64-bit address short.

### Fixed

- AutoHotkey version: holding Fn works when another program sends the Fn key, such as an on-screen keyboard or a key remapper. The overlay used to flash and go, and the next key ran its macro instead of picking a layer.
- AutoHotkey version: `RunPythonScript` and `RunPowerShellScript` run the script. They used to hand Python or PowerShell an empty name before it, so the script never ran. An `&` in the `Args` of `ActivateOrOpen`, `Open` or `EnsureActiveOrOpen` no longer cuts the command line, and these three no longer show an error when no window appears within 5 seconds. An `Args` of `0` is no longer dropped by any of the helpers.
- AutoHotkey version: `ActivateOrOpenChrome` opens a web address with `&` in it whole, brings Chrome to the front after starting it, and no longer waits for ever when no Chrome window appears. `LoadPuttySession` loads a session with spaces in its name, and gives up after 15 seconds when PuTTY shows no window.
- Both versions: the Chrome commands that bring Chrome forward first (`ChromeNewTab`, `ChromeOpenNewWindow`, `ChromeOpenIncognitoWindow`, `ChromeOpenDownloads`, `ChromeOpenHistory`, `ChromeOpenBookmarks`, `ChromeOpenExtensions` and `ChromeOpenSettings`) send their keys only when Chrome is the active window, so the keys no longer reach another program when Chrome does not come forward. `ChromeOpenSettings` and `ChromeOpenExtensions` open their pages through the address bar, since Chrome has no shortcut for either.
- Both versions: `OpenCalculator` finds the Calculator that is already open, instead of starting another one on every press. It finds the window by the app's id and not by its title, so it works in any display language.
- Both versions: `OpenSettings` brings the Settings window to the front, also when Windows started it behind the active window, and a second press brings the open one forward instead of starting it again. Like `OpenCalculator`, it works in any display language.
- Both versions: `OpenPowershell` and `OpenCommandPrompt` find a shell that Windows 11 shows in Windows Terminal, so a second press brings it forward instead of opening another. In the AutoHotkey version `OpenFileExplorer` opens or brings forward a File Explorer window; it used to bring the taskbar forward.
- Both versions: `NextWindow` and `PreviousWindow` were swapped. `NextWindow` now presses Alt+Tab, and `PreviousWindow` Alt+Shift+Tab.
- Both versions: `ExampleOpenFolder` opens the Documents folder wherever Windows keeps it (OneDrive or another drive may hold it), and the AutoHotkey version brings the new window to the front. In the PowerShell version `Open-ExplorerWindow` opens a folder with a comma in its name.
- Both versions: the VS Code commands press the keys VS Code binds. `VsCodePauseDebugging` presses F6, `VsCodeAddInlineBreakpoint` Shift+F9 and `VsCodeOpenTerminal` Ctrl+Shift+backtick. In the AutoHotkey version `VsCodeRestartDebugging` and `VsCodePeekImplementations` press Ctrl+Shift+F5 and Ctrl+Shift+F12 instead of typing letters, and `VsCodeSplitPanel` presses `Ctrl+\`.
- Both versions: `VsStudioShowTestExplorer` presses Ctrl+E and then T alone, as Visual Studio expects, instead of holding Ctrl for both.
- AutoHotkey version: `Restart` restarts the PC. It used to ask Windows in a way that needs a privilege the macropad does not have, so nothing happened.
- Both versions: `WinSleep` and `Hibernate` show an error when Windows refuses, for example when hibernation is turned off, instead of doing nothing. When there is no desktop window, `TurnMonitorsOff` shows an error that asks whether Explorer is running, and in the PowerShell version it gives up after 5 seconds instead of hanging when the desktop does not answer.
- AutoHotkey version: the delayed-key form records the Ctrl, Shift and Alt keys held with the key, and closing the form while it records no longer swallows the next key typed elsewhere. A delay of 0, in the delayed-key and the delayed-click form, sends at once; it used to send nothing.
- PowerShell version: the delayed-key form refuses a key it cannot send as soon as it is recorded or scheduled, and says why.
- PowerShell version: the boxes of `Message` and `ReplaceMe` open in front of the active window, as in the AutoHotkey version, not behind it.
- Configurator: a PowerShell command file saved as ANSI shows letters such as é in the Commands tab as Windows PowerShell reads them, instead of replacement marks.
- Configurator: the Commands tab lists an AutoHotkey command written on one line (`Name(Macro) => ...`) or with a comment after its parameter list, and no longer takes a call at the start of a line for a command.
- Configurator: a PowerShell command written as `function Name($Macro)`, without a `param()` block, or defined with a scope such as `function global:Name`, is listed as a command under its name. The layout check, in the configurator and in `scripts/validate-config.mjs`, accepts the scoped name too.

## 1.0.4 - 2026-11-18

### Added

- Configurator: hovering a function in the Commands tab shows its docs (what it does, how to call it, its examples, and each parameter with its type and default), and the right panel lists what else a command can call. The rows of the right panel show the same card beside the panel; a card too tall for the window scrolls, and the pointer can move onto it to scroll it. Clicking a command under **Commands in this file** shows its whole card below the list, so the docs can be read on a touch screen too. The PowerShell functions meant for commands now carry help blocks, which `Get-Help` reads too, and every AutoHotkey command has a doc block.

## 1.0.3 - 2026-11-17

### Added

- Configurator: the web page shows the project logo as its browser tab icon.

### Changed

- Configurator: a folder without `local/config.json` is now offered only a copy in `local/`. The option to edit the shared example `config.json` itself is gone, so the example stays as everyone gets it.

## 1.0.2 - 2026-11-17

### Added

- Configurator: an empty folder can be set up as a fresh copy. **Open folder** on an empty folder offers to copy in the scripts, the icons and the example layout, and **Create new folder…** on the start screen makes the folder first. The files are carried inside the app, so no download or clone is needed.
- Releases: with the Jenkins global `OMB_REGISTRY` set, each release also pushes the `linux/amd64` image to that private registry ([docs/releasing.md](docs/releasing.md)).

## 1.0.1 - 2026-11-14

### Security

- Build tools: `minimatch` is held at 11.0.8 or newer, which fixes a slow pattern match ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). Only linting and packaging used the affected versions; nothing in the app or the image did.

## 1.0.0 - 2026-11-14

The first release.

### Added

- Configurator: everything that can be dragged can be done from the keyboard. Alt + arrow moves a key on the Pad shape tab and swaps a layer or macro with the key beside it on the other tabs; Shift + Alt + arrow resizes a key; Enter on a command or a parked layer puts it on the selected key.
- Configurator, in the browser: a Download link to the desktop app on the GitHub releases page, in the header and on the start screen.
- Docker images of the web configurator for `linux/amd64` and `linux/arm64`, published at `ghcr.io/hotdog-studio/open-macro-builder`.
- Releases: every green build of `develop` is published as a GitHub release with the Windows installer and a portable exe, and as a container image.
- The hotdog icon redrawn as clean pixel art from an SVG source, and a logo. Both macropad versions and the desktop app use the new icon.
- Developer documentation: `CONTRIBUTING.md` and `docs/`.

### Fixed

- Configurator: a command or parked layer dropped on the Fn key no longer lands on the key beside it.
- Configurator: a key can be picked up again straight after it is dropped.
- Configurator: in a window narrower than the pad, the left columns of the pad can be scrolled to.
- Configurator: with the pad scrolled, a layer dragged to the Parked shelf is parked, not dropped on a key hidden behind the side panel.
- Configurator: the header and the Commands toolbar wrap in a narrow window, so the page no longer scrolls sideways.
- Configurator: a key's resize corner works on a touch screen.
