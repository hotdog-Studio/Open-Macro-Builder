# Layout model and the config DSL (Key, Icon, Layer, Macro, Layout).
# The DSL mirrors ahk/lib/*.ahk argument for argument. Class type literals are used
# only in this file; everything else builds objects through the DSL functions.

class KeyLabel {
    [int]$X; [int]$Y; [int]$W; [int]$H
    KeyLabel([int]$x, [int]$y, [int]$w, [int]$h) { $this.X = $x; $this.Y = $y; $this.W = $w; $this.H = $h }
}

class Key {
    [string]$Name; [int]$Row; [int]$Col; [int]$Width; [int]$Height
    [int]$X; [int]$Y; [int]$W; [int]$H
    [object]$Label

    Key([string]$name, [int]$row, [int]$col, [int]$width, [int]$height) {
        $this.Name = $name; $this.Row = $row; $this.Col = $col; $this.Width = $width; $this.Height = $height
        $this.SetUnlabelledPosition()
    }

    # A 17 px label sits above each key; rows are 83 px apart (as ahk/lib/key.ahk).
    [void] SetLabelledPosition() {
        $this.Label = [KeyLabel]::new(($this.Col - 1) * 64, ($this.Row - 1) * 83, 64 * $this.Width, 17)
        $this.X = $this.Label.X
        $this.Y = $this.Label.Y + 17
        $this.W = $this.Label.W
        $this.H = 64 * $this.Height + ($this.Height - 1) * 17
    }

    [void] SetUnlabelledPosition() {
        $this.Label = [KeyLabel]::new(0, 0, 0, 0)
        $this.X = ($this.Col - 1) * 64
        $this.Y = ($this.Row - 1) * 64
        $this.W = 64 * $this.Width
        $this.H = 64 * $this.Height
    }
}

class IconSet {
    [string]$Name; [string]$Dir; [string]$Layer; [string]$Macro; [string]$Selected; [string]$SelectedMacro
    # Images already looked up for a key size, by "<state> <w>x<h>".
    [hashtable]$Sized = @{}
}

class Macro {
    [object]$Action; [string]$Name; [string]$Description; [object]$Icon
}

class Layer {
    [string]$Title; [object]$Icon; [object[]]$Macros
}

class Layout {
    [object]$Fn; [object[]]$Keys; [object[]]$Layers; [int]$DefaultIndex
    [string]$ShowFn; [bool]$ShowMacroMarkers; [bool]$ShowLabels; [bool]$UseMacroIcons; [string]$IconAction
}

function Test-BlankEntry {
    param($Value)
    ($null -eq $Value) -or (($Value -is [string]) -and $Value -eq '')
}

function Key {
    param([string]$Name, [int]$Row = 1, [int]$Col = 1, [int]$Width = 1, [int]$Height = 1)
    [Key]::new($Name, $Row, $Col, $Width, $Height)
}

function Icon {
    param([string]$Name)
    $set = [IconSet]::new()
    $set.Name = $Name
    $set.Dir = Get-IconSetDir $Name
    $set.Layer = Join-Path $set.Dir 'layer.png'
    $set.Macro = Join-Path $set.Dir 'macro.png'
    $set.Selected = Join-Path $set.Dir 'selected.png'
    $set.SelectedMacro = Join-Path $set.Dir 'selected_macro.png'
    $set
}

# One state's image for a key: <state>_<w>x<h>.png when the set has it for the key's size, else <state>.png.
function Get-IconImage {
    param(
        [Parameter(Mandatory)]$Set,
        [Parameter(Mandatory)][ValidateSet('Layer', 'Macro', 'Selected', 'SelectedMacro')][string]$State,
        [Parameter(Mandatory)]$Key
    )
    $id = "$State $($Key.Width)x$($Key.Height)"
    if (-not $Set.Sized.ContainsKey($id)) { $Set.Sized[$id] = Get-SizedAssetPath $Set.$State $Key.Width $Key.Height }
    $Set.Sized[$id]
}

function Macro {
    param($Action, [string]$Name, [string]$Description = '', $Icon = $null)
    $m = [Macro]::new()
    $m.Action = $Action; $m.Name = $Name; $m.Description = $Description; $m.Icon = $Icon
    $m
}

function Layer {
    param([string]$Title, $Icon, [object[]]$Macros = @())
    $slots = [System.Collections.Generic.List[object]]::new()
    foreach ($m in @($Macros)) {
        if (Test-BlankEntry $m) { $slots.Add($null) } else { $slots.Add($m) }
    }
    $l = [Layer]::new()
    $l.Title = $Title; $l.Icon = $Icon; $l.Macros = $slots.ToArray()
    $l
}

function Layout {
    param(
        $FunctionKey,
        [object[]]$MacroKeys,
        [object[]]$Layers = @(),
        [int]$Default = 1,
        $ShowFn = $false,
        [bool]$ShowMacroMarkers = $false,
        [bool]$ShowLabels = $false,
        [bool]$UseMacroIcons = $false,
        [string]$IconAction = 'Layer'
    )
    $keys = @($MacroKeys)
    $given = @($Layers)
    if ($given.Count -gt $keys.Count) {
        throw "Too many layers ($($given.Count)) for this amount of buttons ($($keys.Count))."
    }
    $slots = [System.Collections.Generic.List[object]]::new()
    foreach ($layer in $given) {
        if (Test-BlankEntry $layer) { $slots.Add($null); continue }
        if (@($layer.Macros).Count -gt $keys.Count) {
            throw "Too many macros ($(@($layer.Macros).Count)) for this amount of buttons ($($keys.Count)). - $($layer.Title) Layer"
        }
        $slots.Add($layer)
    }
    if ($IconAction -cne 'Macro' -and $IconAction -cne 'Layer') {
        throw "Invalid action. Use 'Macro' or 'Layer'."
    }

    if ($ShowFn -is [bool]) {
        if ($ShowFn) { $fnText = $FunctionKey.Name } else { $fnText = '' }
    } elseif ($null -eq $ShowFn) {
        $fnText = ''
    } else {
        $fnText = [string]$ShowFn
    }

    # Geometry depends on whether labels are shown (ahk Layout.__ApplyLabels).
    foreach ($k in @($FunctionKey) + $keys) {
        if ($ShowLabels) { $k.SetLabelledPosition() } else { $k.SetUnlabelledPosition() }
    }

    $l = [Layout]::new()
    $l.Fn = $FunctionKey
    $l.Keys = $keys
    $l.Layers = $slots.ToArray()
    $l.DefaultIndex = $Default - 1
    $l.ShowFn = $fnText
    $l.ShowMacroMarkers = $ShowMacroMarkers
    $l.ShowLabels = $ShowLabels
    $l.UseMacroIcons = $UseMacroIcons
    $l.IconAction = $IconAction
    $l
}

function Test-NoLayers {
    param($Layout)
    foreach ($layer in @($Layout.Layers)) {
        if ($null -ne $layer) { return $false }
    }
    $true
}

function Get-InitialLayerIndex {
    param($Layout)
    $layers = @($Layout.Layers)
    $d = $Layout.DefaultIndex
    if ($d -ge 0 -and $d -lt $layers.Count -and $null -ne $layers[$d]) { return $d }
    for ($i = 0; $i -lt $layers.Count; $i++) {
        if ($null -ne $layers[$i]) { return $i }
    }
    -1
}

# The function an action names, found the one way a key runs it (Invoke-Macro) and the start-up checks
# (Test-LayoutActions, Test-HotkeyActions) look for it, so that the three cannot disagree; $null when
# there is none. Only a function counts (a filter is one too): an alias of the same name does not hide
# it, and a name that carries a module (Module\Cmdlet) finds that cmdlet, which is not one. The name is
# taken as it is written, never as a wildcard: Get-Command would find a function for Get-*, * or Do[1],
# and the key none. The lookup runs from the caller's scope, so it sees the commands main.ps1 dot-sourced.
function Get-MacroFunction {
    param([string]$Name)
    if ([string]::IsNullOrEmpty($Name)) { return $null }
    $found = $ExecutionContext.InvokeCommand.GetCommand($Name, [System.Management.Automation.CommandTypes]::Function)
    if ($found -is [System.Management.Automation.FunctionInfo]) { $found } else { $null }
}

function Test-LayoutActions {
    param($Layout)
    $missing = [System.Collections.Generic.List[string]]::new()
    foreach ($layer in @($Layout.Layers)) {
        if ($null -eq $layer) { continue }
        foreach ($m in @($layer.Macros)) {
            if ($null -eq $m -or $m.Action -isnot [string]) { continue }
            if ($null -eq (Get-MacroFunction $m.Action)) {
                $missing.Add("$($m.Action) ($($m.Name))")
            }
        }
    }
    if ($missing.Count -gt 0) { throw "Undefined macro action(s): $($missing -join ', ')" }
}
