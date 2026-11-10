#Requires AutoHotkey v2.0

/**
 * @class
 * @description
 * A small JSON parser for config.json. Objects become Maps (case-sensitive keys), arrays become
 * Arrays, true/false become 1/0, and null becomes "" (a blank layer or macro slot, as in the old
 * config.ahk). Throws an Error naming the position of the first problem.
 */
class Json {
    /**
     * @param {(String)} Text The JSON text.
     * @returns The parsed value.
     */
    static Parse(Text) {
        pos := 1
        value := Json._Value(Text, &pos)
        Json._SkipWhitespace(Text, &pos)
        if (pos <= StrLen(Text))
            throw Error("Unexpected '" SubStr(Text, pos, 1) "' at position " pos)
        return value
    }

    static _SkipWhitespace(Text, &pos) {
        while (pos <= StrLen(Text)) {
            c := SubStr(Text, pos, 1)
            if (c != " " && c != "`t" && c != "`r" && c != "`n")
                break
            pos++
        }
    }

    static _Value(Text, &pos) {
        Json._SkipWhitespace(Text, &pos)
        if (pos > StrLen(Text))
            throw Error("Unexpected end of JSON")
        c := SubStr(Text, pos, 1)
        if (c == "{")
            return Json._Object(Text, &pos)
        if (c == "[")
            return Json._Array(Text, &pos)
        if (c == '"')
            return Json._String(Text, &pos)
        if (SubStr(Text, pos, 4) == "true") {
            pos += 4
            return true
        }
        if (SubStr(Text, pos, 5) == "false") {
            pos += 5
            return false
        }
        if (SubStr(Text, pos, 4) == "null") {
            pos += 4
            return ""
        }
        if (RegExMatch(Text, "\G-?\d+(\.\d+)?([eE][+-]?\d+)?", &m, pos)) {
            pos += m.Len
            return Number(m[0])
        }
        throw Error("Unexpected '" c "' at position " pos)
    }

    static _Object(Text, &pos) {
        obj := Map()
        pos++
        Json._SkipWhitespace(Text, &pos)
        if (SubStr(Text, pos, 1) == "}") {
            pos++
            return obj
        }
        loop {
            Json._SkipWhitespace(Text, &pos)
            if (SubStr(Text, pos, 1) != '"')
                throw Error("Expected a property name at position " pos)
            key := Json._String(Text, &pos)
            Json._SkipWhitespace(Text, &pos)
            if (SubStr(Text, pos, 1) != ":")
                throw Error("Expected ':' at position " pos)
            pos++
            obj[key] := Json._Value(Text, &pos)
            Json._SkipWhitespace(Text, &pos)
            c := SubStr(Text, pos, 1)
            if (c == "}") {
                pos++
                return obj
            }
            if (c != ",")
                throw Error("Expected ',' or '}' at position " pos)
            pos++
        }
    }

    static _Array(Text, &pos) {
        arr := []
        pos++
        Json._SkipWhitespace(Text, &pos)
        if (SubStr(Text, pos, 1) == "]") {
            pos++
            return arr
        }
        loop {
            arr.Push(Json._Value(Text, &pos))
            Json._SkipWhitespace(Text, &pos)
            c := SubStr(Text, pos, 1)
            if (c == "]") {
                pos++
                return arr
            }
            if (c != ",")
                throw Error("Expected ',' or ']' at position " pos)
            pos++
        }
    }

    static _String(Text, &pos) {
        pos++
        out := ""
        loop {
            if (pos > StrLen(Text))
                throw Error("Unterminated string")
            c := SubStr(Text, pos, 1)
            pos++
            if (c == '"')
                return out
            if (c != "\") {
                out .= c
                continue
            }
            e := SubStr(Text, pos, 1)
            pos++
            switch e, true {
                case '"': out .= '"'
                case "\": out .= "\"
                case "/": out .= "/"
                case "b": out .= "`b"
                case "f": out .= "`f"
                case "n": out .= "`n"
                case "r": out .= "`r"
                case "t": out .= "`t"
                case "u":
                    out .= Chr(Integer("0x" SubStr(Text, pos, 4)))
                    pos += 4
                default: throw Error("Bad escape '\" e "' at position " (pos - 1))
            }
        }
    }
}
