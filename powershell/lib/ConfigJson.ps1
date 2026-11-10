# The macropad config lives in macropad_ahk\config.json, shared with the AutoHotkey version
# (ahk\config.ahk reads the same file). This turns it into the DSL objects from Model.ps1 and,
# for hotkeys and hotstrings, Hotkeys.ps1.
#
# Layers and macro slots that are null are blank; a layer with "disabled": true is skipped
# entirely (it keeps its definition in the file without taking a key).

function Get-MacropadConfigPath {
    Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'config.json'
}

function Read-MacropadConfigJson {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Config file not found: $Path" }
    try {
        Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "Invalid JSON in '$Path': $($_.Exception.Message)"
    }
}

# A property's value, or $Default when the object lacks it.
function Get-JsonValue {
    param($Object, [string]$Name, $Default)
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    $Default
}

function ConvertFrom-KeyJson {
    param($Json)
    Key $Json.key (Get-JsonValue $Json 'row' 1) (Get-JsonValue $Json 'col' 1) (Get-JsonValue $Json 'width' 1) (Get-JsonValue $Json 'height' 1)
}

function ConvertFrom-MacroJson {
    param($Json)
    if ($null -eq $Json) { return '' }
    $icon = $null
    $iconName = Get-JsonValue $Json 'icon' ''
    if ($iconName) { $icon = Icon $iconName }
    Macro $Json.action $Json.name (Get-JsonValue $Json 'description' '') $icon
}

function Import-MacropadConfig {
    param([Parameter(Mandatory)][string]$Path)
    $json = Read-MacropadConfigJson $Path
    $keys = @(foreach ($k in @($json.keys)) { ConvertFrom-KeyJson $k })
    $layers = [System.Collections.Generic.List[object]]::new()
    foreach ($l in @($json.layers)) {
        if ($null -eq $l) { $layers.Add(''); continue }
        if (Get-JsonValue $l 'disabled' $false) { continue }
        $macros = [System.Collections.Generic.List[object]]::new()
        foreach ($m in @(Get-JsonValue $l 'macros' @())) { $macros.Add((ConvertFrom-MacroJson $m)) }
        $layers.Add((Layer $l.title (Icon $l.icon) $macros.ToArray()))
    }
    Layout (ConvertFrom-KeyJson $json.fn) $keys $layers.ToArray() `
        (Get-JsonValue $json 'default' 1) `
        (Get-JsonValue $json 'showFn' $false) `
        ([bool](Get-JsonValue $json 'showMacroMarkers' $false)) `
        ([bool](Get-JsonValue $json 'showLabels' $false)) `
        ([bool](Get-JsonValue $json 'useMacroIcons' $false)) `
        ([string](Get-JsonValue $json 'iconAction' 'Layer'))
}

# Hotkey and Hotstring definitions from the config's "hotkeys" and "hotstrings" lists.
function Import-MacropadHotkeys {
    param([Parameter(Mandatory)][string]$Path)
    $json = Read-MacropadConfigJson $Path
    $defs = [System.Collections.Generic.List[object]]::new()
    foreach ($h in @(Get-JsonValue $json 'hotkeys' @())) {
        if ($null -eq $h) { continue }
        $defs.Add((Hotkey $h.hotkey $h.action -IfWinActive (Get-JsonValue $h 'ifWinActive' '') -IfWinNotActive (Get-JsonValue $h 'ifWinNotActive' '')))
    }
    foreach ($s in @(Get-JsonValue $json 'hotstrings' @())) {
        if ($null -eq $s) { continue }
        # An action runs a macro, which needs the X option; both loaders enforce this the same way.
        $execute = (ConvertFrom-AhkHotstring $s.hotstring).Execute
        $hasAction = [bool](Get-JsonValue $s 'action' '')
        if ($hasAction -and -not $execute) { throw "Hotstring '$($s.hotstring)' has an action but no X option." }
        if ($execute -and -not $hasAction) { throw "Hotstring '$($s.hotstring)' has the X option but no action." }
        if ($execute) { $value = $s.action } else { $value = $s.replacement }
        $defs.Add((Hotstring $s.hotstring $value -IfWinActive (Get-JsonValue $s 'ifWinActive' '') -IfWinNotActive (Get-JsonValue $s 'ifWinNotActive' '')))
    }
    $defs.ToArray()
}
