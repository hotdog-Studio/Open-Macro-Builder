#Requires AutoHotkey v2.0
#NoTrayIcon
; Prints what lib\json.ahk makes of a few inputs; powershell\tests\AhkJson.Tests.ps1 checks the output.
#Include ..\lib\json.ahk

out := ""
a := Json.Parse('[1, 2.5, -3e2, true, false, null]')
out .= "len=" a.Length " a1=" a[1] " a2=" a[2] " a3=" a[3] " t=" a[4] " f=" a[5] " null=[" a[6] "]`n"
s := Json.Parse('"x\"y\\z\né\/"')
out .= "string ok=" (s == 'x"y\z' "`n" Chr(0xE9) "/") "`n"
m := Json.Parse('{}')
e := Json.Parse('[]')
out .= "map=" (m is Map) " count=" m.Count " array=" (e is Array) " len=" e.Length "`n"
n := Json.Parse('{"x": {"y": [{"z": "deep"}]}}')
out .= "nested=" n["x"]["y"][1]["z"] "`n"
for bad in ['{"k": [1, 2 3]}', '"abc'] {
    try {
        Json.Parse(bad)
        out .= "error=none`n"
    } catch Error as err {
        out .= "error=" err.Message "`n"
    }
}
FileAppend(out, "*", "UTF-8-RAW")
ExitApp(0)
