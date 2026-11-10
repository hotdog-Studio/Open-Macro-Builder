#Requires AutoHotkey v2.0
#NoTrayIcon
; Prints the layout config.ahk builds from ..\config.json in the same canonical form as
; powershell\tests\helpers\ConfigDump.ps1, so powershell\tests\Config.Tests.ps1 can check that
; both versions read the file the same way. Run: AutoHotkey64.exe /ErrorStdOut dump_config.ahk
#Include lib\ui.ahk
#Include config.ahk

IconFolder(icon) {
    if (!IsObject(icon))
        return ""
    SplitPath(icon.layer, , &dir)
    SplitPath(dir, &folder)
    return folder
}

KeyLine(k) => k.key " " k.row " " k.col " " k.width " " k.height

loaded := Config()
data := ConfigData()
out := "fn " KeyLine(loaded.fn)
for i, k in loaded.keys
    out .= "`nkey " (i - 1) " " KeyLine(k)
out .= "`ndefault " loaded.default
out .= "`nshowFn [" (loaded.showFn ? loaded.showFn : "") "]"
out .= "`nflags " (loaded.showMacroMarkers ? 1 : 0) " " (loaded.showLabels ? 1 : 0) " " (loaded.macroIcons ? 1 : 0) " " (loaded.iconAction ? "Macro" : "Layer")
for i, l in loaded.layers {
    if (!IsObject(l)) {
        out .= "`nlayer " (i - 1) " -"
        continue
    }
    out .= "`nlayer " (i - 1) " " l.title "|" IconFolder(l.icon)
    for j, m in l.macros {
        if (!IsObject(m)) {
            out .= "`nmacro " (i - 1) " " (j - 1) " -"
            continue
        }
        out .= "`nmacro " (i - 1) " " (j - 1) " " m.action.Name "|" m.name "|" m.description "|" IconFolder(m.icon)
    }
}
for h in data.Get("hotkeys", [])
    out .= "`nhotkey " h["hotkey"] "|" h["action"] "|" h.Get("ifWinActive", "") "|" h.Get("ifWinNotActive", "")
for s in data.Get("hotstrings", [])
    out .= "`nhotstring " s["hotstring"] "|" (s.Has("action") ? s["action"] : s["replacement"]) "|" s.Get("ifWinActive", "") "|" s.Get("ifWinNotActive", "")
FileAppend(out "`n", "*", "UTF-8-RAW")
ExitApp(0)
