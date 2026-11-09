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
    [string]$Name; [string]$Layer; [string]$Macro; [string]$Selected; [string]$SelectedMacro
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
    $set.Layer = Get-AssetPath "$Name\layer.png"
    $set.Macro = Get-AssetPath "$Name\macro.png"
    $set.Selected = Get-AssetPath "$Name\selected.png"
    $set.SelectedMacro = Get-AssetPath "$Name\selected_macro.png"
    $set
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

function Test-LayoutActions {
    param($Layout)
    $missing = [System.Collections.Generic.List[string]]::new()
    foreach ($layer in @($Layout.Layers)) {
        if ($null -eq $layer) { continue }
        foreach ($m in @($layer.Macros)) {
            if ($null -eq $m -or $m.Action -isnot [string]) { continue }
            if (-not (Get-Command -Name $m.Action -CommandType Function -ErrorAction SilentlyContinue)) {
                $missing.Add("$($m.Action) ($($m.Name))")
            }
        }
    }
    if ($missing.Count -gt 0) { throw "Undefined macro action(s): $($missing -join ', ')" }
}
