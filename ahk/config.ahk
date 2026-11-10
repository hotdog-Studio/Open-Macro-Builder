#Requires AutoHotkey v2.0

; *************************** Libraries ***************************
#Include lib\icon.ahk
#Include lib\key.ahk
#Include lib\layout.ahk
#Include lib\layer.ahk
#Include lib\macro.ahk
#Include lib\json.ahk

; *************************** Commands ***************************
#Include commands\helper.ahk
#Include commands\media.ahk
#Include commands\power.ahk
#Include commands\windows.ahk

; ************************ Custom Commands ************************
; Add your custom command files here
#Include commands\custom\chrome.ahk
#Include commands\custom\dev.ahk
#Include commands\custom\programs.ahk
#Include commands\custom\server.ahk
#Include commands\custom\vscode.ahk
#Include commands\custom\vsstudio.ahk
#Include commands\custom\automation.ahk


; *********************** Macro Definitions ***********************
; The layout lives in ..\config.json, shared with the PowerShell version (powershell\config.ps1
; reads the same file). Edit that file, not this one:
;   "fn" and "keys"   the function key and macro keys: key name, row, col, optional width/height
;   "layers"          one per macro key: title, icon (folder in ..\img) and macros; null skips a
;                     layer, "disabled": true keeps a layer in the file without using a key
;   "macros"          one per macro key: action (a command function name), name, description and
;                     an optional icon; null skips a key
;   "default", "showFn", "showMacroMarkers", "showLabels", "useMacroIcons", "iconAction"
;                     the Layout options
;   "hotkeys", "hotstrings"  optional extra hotkeys and hotstrings (see RegisterConfigHotkeys)

/**
 * @description The full path of config.json (beside the ahk folder).
 */
ConfigFile() {
    SplitPath(A_ScriptDir, , &parent)
    return parent "\config.json"
}

/**
 * @description The parsed config.json, read once.
 */
ConfigData() {
    static data := ""
    if (IsObject(data))
        return data
    path := ConfigFile()
    if (!FileExist(path))
        throw Error("Config file not found: " path)
    try {
        data := Json.Parse(FileRead(path, "UTF-8"))
    } catch Error as err {
        throw Error("Invalid JSON in '" path "': " err.Message)
    }
    return data
}

/**
 * @description The command function named Name, or "" when there is none.
 */
ConfigAction(Name) {
    try {
        fn := %Name%
    } catch {
        return ""
    }
    return (fn is Func) ? fn : ""
}

ConfigKey(Entry) {
    return Key(Entry["key"], Entry.Get("row", 1), Entry.Get("col", 1), Entry.Get("width", 1), Entry.Get("height", 1))
}

/**
 * @description
 * Configures and returns the layout for the macropad from config.json.
 * @returns {Layout} The configured layout object.
 * @throws {Error} Listing every macro action that names no function.
 */
Config() {
    data := ConfigData()
    keys := []
    for entry in data["keys"]
        keys.Push(ConfigKey(entry))

    layers := []
    missing := ""
    for entry in data["layers"] {
        if (!IsObject(entry)) {
            layers.Push("")
            continue
        }
        if (entry.Get("disabled", false))
            continue
        macros := []
        for m in entry.Get("macros", []) {
            if (!IsObject(m)) {
                macros.Push("")
                continue
            }
            fn := ConfigAction(m["action"])
            if (!IsObject(fn)) {
                missing .= (missing ? ", " : "") m["action"] " (" m["name"] ")"
                macros.Push("")
                continue
            }
            macroIcon := m.Get("icon", "") ? Icon(m["icon"]) : ""
            macros.Push(Macro(fn, m["name"], m.Get("description", ""), macroIcon))
        }
        layers.Push(Layer(entry["title"], Icon(entry["icon"]), macros))
    }
    if (missing)
        throw Error("Undefined macro action(s): " missing)

    ; showFn true shows the function key's name, as in the PowerShell version.
    showFn := data.Get("showFn", false)
    if (!(showFn is String) && showFn)
        showFn := data["fn"]["key"]

    return Layout(ConfigKey(data["fn"]), keys, layers, data.Get("default", 1), showFn,
        data.Get("showMacroMarkers", false), data.Get("showLabels", false), data.Get("useMacroIcons", false),
        data.Get("iconAction", "Layer"))
}

/**
 * @description
 * Registers the optional "hotkeys" and "hotstrings" from config.json:
 *   { "hotkey": "^!e", "action": "OpenFileExplorer", "ifWinActive": "ahk_exe code.exe" }
 *   { "hotstring": "::btw", "replacement": "by the way" }
 *   { "hotstring": ":X:now", "action": "SomeCommand" }   (an action needs the X option)
 * "ifWinActive" / "ifWinNotActive" take a WinTitle, as #HotIfWinActive does.
 */
RegisterConfigHotkeys() {
    data := ConfigData()
    for entry in data.Get("hotkeys", []) {
        if (!IsObject(entry))
            continue
        ConfigHotIf(entry)
        Hotkey(entry["hotkey"], ConfigRunner(ConfigMacro(entry, entry["hotkey"])))
    }
    for entry in data.Get("hotstrings", []) {
        if (!IsObject(entry))
            continue
        spec := entry["hotstring"]
        RegExMatch(spec, "^:([^:]*):", &opts)
        execute := IsObject(opts) && RegExMatch(opts[1], "i)X(?!0)")
        if (entry.Has("action") && !execute)
            throw Error("Hotstring '" spec "' has an action but no X option.")
        if (execute && !entry.Has("action"))
            throw Error("Hotstring '" spec "' has the X option but no action.")
        ConfigHotIf(entry)
        if (execute)
            Hotstring(spec, ConfigRunner(ConfigMacro(entry, spec)))
        else
            Hotstring(spec, entry["replacement"])
    }
    HotIf()
}

ConfigMacro(Entry, Name) {
    fn := ConfigAction(Entry["action"])
    if (!IsObject(fn))
        throw Error("Undefined hotkey action: " Entry["action"] " (" Name ")")
    return Macro(fn, Name, Entry.Get("description", ""))
}

ConfigRunner(M) {
    return (*) => M.action()
}

ConfigHotIf(Entry) {
    if (Entry.Get("ifWinActive", ""))
        HotIfWinActive(Entry["ifWinActive"])
    else if (Entry.Get("ifWinNotActive", ""))
        HotIfWinNotActive(Entry["ifWinNotActive"])
    else
        HotIf()
}
