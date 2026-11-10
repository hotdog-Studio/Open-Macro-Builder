# Canonical text dump of a loaded config, line for line the same as ahk/dump_config.ahk prints,
# so the PowerShell and AutoHotkey loaders can be compared as plain strings.

function Get-IconFolder {
    param($IconSet)
    if ($null -eq $IconSet) { return '' }
    Split-Path (Split-Path $IconSet.Layer -Parent) -Leaf
}

function Get-MacropadConfigDump {
    param($Layout, [object[]]$Hotkeys = @())
    $lines = [System.Collections.Generic.List[string]]::new()
    $k = $Layout.Fn
    $lines.Add("fn $($k.Name) $($k.Row) $($k.Col) $($k.Width) $($k.Height)")
    $keys = @($Layout.Keys)
    for ($i = 0; $i -lt $keys.Count; $i++) {
        $k = $keys[$i]
        $lines.Add("key $i $($k.Name) $($k.Row) $($k.Col) $($k.Width) $($k.Height)")
    }
    $lines.Add("default $($Layout.DefaultIndex + 1)")
    $lines.Add("showFn [$($Layout.ShowFn)]")
    $lines.Add("flags $([int]$Layout.ShowMacroMarkers) $([int]$Layout.ShowLabels) $([int]$Layout.UseMacroIcons) $($Layout.IconAction)")
    $layers = @($Layout.Layers)
    for ($i = 0; $i -lt $layers.Count; $i++) {
        $l = $layers[$i]
        if ($null -eq $l) { $lines.Add("layer $i -"); continue }
        $lines.Add("layer $i $($l.Title)|$(Get-IconFolder $l.Icon)")
        $macros = @($l.Macros)
        for ($j = 0; $j -lt $macros.Count; $j++) {
            $m = $macros[$j]
            if ($null -eq $m) { $lines.Add("macro $i $j -"); continue }
            $lines.Add("macro $i $j $($m.Action)|$($m.Name)|$($m.Description)|$(Get-IconFolder $m.Icon)")
        }
    }
    foreach ($d in @($Hotkeys)) {
        if ($d.Kind -eq 'Hotkey') { $value = $d.Macro.Action }
        elseif ($d.Parsed.Execute) { $value = $d.Macro.Action }
        else { $value = $d.Replacement }
        $lines.Add("$($d.Kind.ToLowerInvariant()) $($d.Spec)|$value|$($d.IfWinActive)|$($d.IfWinNotActive)")
    }
    $lines -join "`n"
}
