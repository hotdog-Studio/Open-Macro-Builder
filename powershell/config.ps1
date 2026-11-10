# Placeholder config: two layers to prove the wiring. Replaced by the full port of ahk/config.ahk.

function Get-MacropadConfig {
    Layout (Key 'ScrollLock' 4 1 2 1) @(
        (Key 'F13' 1 1),
        (Key 'F14' 1 2),
        (Key 'F15' 1 3),
        (Key 'F16' 2 1),
        (Key 'F17' 2 2),
        (Key 'F18' 2 3),
        (Key 'F19' 3 1),
        (Key 'F20' 3 2),
        (Key 'F21' 3 3),
        (Key 'F22' 1 4 1 2),
        (Key 'F23' 3 4 1 2),
        (Key 'F24' 4 3)
    ) @(
        (Layer 'Programs' (Icon 'programs') @(
            (Macro ReplaceMe 'One'),
            (Macro Message 'Two' 'Second slot')
        )),
        (Layer 'Chrome' (Icon 'chrome') @(
            (Macro ReplaceMe 'Three')
        ))
    ) 1 ' ' $true $true
}
