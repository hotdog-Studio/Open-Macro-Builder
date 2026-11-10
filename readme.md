# Open Macro Builder
*Build your perfect macropad, with any keyboard.*

Turn a spare keypad into layers of macros. Bind its keys to F13 to F24 and pick one key as Fn. Hold Fn to see an overlay of your layers and tap a key to choose one. Let go, and each key runs the macro in its slot of that layer.

## Two versions, one config

| Folder | Runs on | Notes |
| --- | --- | --- |
| `ahk/` | [AutoHotkey v2](https://www.autohotkey.com/download/) | The original version. |
| `powershell/` | Windows PowerShell 5.1, built into Windows | Nothing to install. See [powershell/README.md](powershell/README.md). |

Both read the same `config.json`, use the same icons in `img/` and have the same command names, so you can switch between them without touching your layout. Run one at a time: both claim the macro keys.

## Getting started

**AutoHotkey:** install AutoHotkey v2, edit `config.json`, then run `ahk/main.ahk`.

**PowerShell:** edit `config.json`, then run `wscript powershell\launch.vbs`.

To start either one with Windows, point the shortcut in `shell:startup` at `ahk\main.ahk` or at `launch.vbs` (powershell/README.md has the steps).

## config.json

```json
{
  "fn": { "key": "ScrollLock", "row": 4, "col": 1, "width": 2 },
  "keys": [
    { "key": "F13", "row": 1, "col": 1 },
    { "key": "F14", "row": 1, "col": 2 },
    { "key": "F22", "row": 1, "col": 4, "height": 2 }
  ],
  "layers": [
    {
      "title": "Programs",
      "icon": "programs",
      "macros": [
        { "action": "OpenYoutube", "name": "YouTube", "description": "Open YouTube in Chrome" },
        null,
        { "action": "OpenFileExplorer", "name": "File Explorer" }
      ]
    },
    null,
    { "title": "Dev Environment", "icon": "portainer", "disabled": true, "macros": [] }
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

- `fn` is the key you hold to choose a layer. `keys` are the macro keys, placed on a grid by `row` and `col`, with `width` and `height` in keys (default 1).
- Layers and macros are matched to keys by position: the first layer belongs to the first key, and so on. `null` leaves a slot empty. `"disabled": true` keeps a layer in the file without giving it a key.
- `icon` names a folder in `img/` holding `layer.png`, `macro.png`, `selected.png` and `selected_macro.png`.
- `action` names a command function. `name` is the label shown above the key, and `description` is its tooltip.
- `default` is the layer selected at startup, counted from 1. `showFn` is the text above the Fn key. `showMacroMarkers` marks keys that have a macro on the selected layer, and `showLabels` shows the macro names. `useMacroIcons` and `iconAction` change what the overlay's icons show and do.
- `hotkeys` and `hotstrings` add ordinary AutoHotkey-style hotkeys and hotstrings, such as `{ "hotkey": "^!e", "action": "OpenFileExplorer" }` and `{ "hotstring": "::btw", "replacement": "by the way" }`. powershell/README.md describes the options.

`node scripts/validate-config.mjs` checks the file: its structure, the icon folders, and that every action exists in both versions.

## Commands

Command functions live in `ahk/commands/` and `powershell/commands/`, with the same names in both. Each takes the macro as its only parameter. Put your own in the `custom/` folders. In AutoHotkey, add an `#Include` for the file to `ahk/config.ahk`. In PowerShell, every `.ps1` file under `powershell/commands` is loaded automatically.

## Repository layout

- `config.json`: the layout both versions read.
- `ahk/`: the AutoHotkey version (`main.ahk`, `lib/`, `commands/`).
- `powershell/`: the PowerShell version, its tests and its docs.
- `img/`: icon sets, one folder per icon.
- `qmk/`: the VIA/QMK layout of the EPOMAKER EK21 keypad this was built for.
- `scripts/`: the config validator and its tests.
- `docs/`: design plans.
- `Jenkinsfile`, `sonar-project.properties`: CI.

## Tests and CI

```
node --test "scripts/*.test.mjs"                          # config validator
powershell -NoProfile -File powershell\tests\run.ps1      # Pester suite (Windows)
```

Jenkins validates `config.json` and runs the script tests on the Linux agent. It runs the Pester suite on a Windows agent when the `OMB_WINDOWS_LABEL` global names one, then sends everything to SonarQube and waits for the quality gate. The `Jenkinsfile` header lists the globals.

## Showcase

### Example with Numpad
![numpad example](img/showcase.png)

## License

See [LICENSE](LICENSE).
