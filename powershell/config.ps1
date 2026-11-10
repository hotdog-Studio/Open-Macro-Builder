# The macropad config is ..\config.json, shared with the AutoHotkey version (ahk\config.ahk reads
# the same file). Edit that file; this one only loads it. See README.md for the format.

function Get-MacropadConfig {
    Import-MacropadConfig (Get-MacropadConfigPath)
}

function Get-MacropadHotkeys {
    Import-MacropadHotkeys (Get-MacropadConfigPath)
}
