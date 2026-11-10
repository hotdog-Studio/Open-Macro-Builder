# AHK-style hotkeys for config.ps1 (define Get-MacropadHotkeys returning Hotkey definitions).
# Fired hotkeys run through Invoke-EngineMacro, so the macro guard covers them and their errors
# are reported like macro errors.

function Hotkey {
    param([Parameter(Mandatory)][string]$Spec, [Parameter(Mandatory)]$Action)
    [pscustomobject]@{
        Kind   = 'Hotkey'
        Spec   = $Spec
        Parsed = ConvertFrom-AhkHotkey $Spec
        Macro  = Macro $Action $Spec
    }
}

# Like Test-LayoutActions: every string action must name a function.
function Test-HotkeyActions {
    param([object[]]$Definitions)
    $missing = [System.Collections.Generic.List[string]]::new()
    foreach ($d in @($Definitions)) {
        if ($null -eq $d.Macro -or $d.Macro.Action -isnot [string]) { continue }
        if (-not (Get-Command -Name $d.Macro.Action -CommandType Function -ErrorAction SilentlyContinue)) {
            $missing.Add("$($d.Macro.Action) ($($d.Spec))")
        }
    }
    if ($missing.Count -gt 0) { throw "Undefined hotkey action(s): $($missing -join ', ')" }
}

function New-InputHook {
    param([object[]]$Definitions, $Engine, $Layout, [switch]$NoStart)
    $Definitions = @($Definitions)

    # A hotkey on a macropad key would starve the layer engine.
    $padKeys = @{}
    foreach ($k in @($Layout.Fn) + @($Layout.Keys)) { $padKeys[[int](Get-AhkVirtualKey $k.Name)] = $k.Name }
    foreach ($d in $Definitions) {
        if ($d.Kind -ne 'Hotkey') { continue }
        foreach ($vk in @($d.Parsed.Vk, $d.Parsed.PrefixVk)) {
            if ($vk -ne 0 -and $padKeys.ContainsKey([int]$vk)) { throw "Hotkey '$($d.Spec)' uses macropad key '$($padKeys[[int]$vk])'." }
        }
    }

    $hook = [Macropad.InputHook]::new()
    for ($i = 0; $i -lt $Definitions.Count; $i++) {
        $d = $Definitions[$i]
        if ($d.Kind -ne 'Hotkey') { continue }
        $p = $d.Parsed
        $flags = [int]$p.Wildcard + 2 * [int]$p.Passthrough + 4 * [int]$p.KeyUp
        $hook.AddHotkey($i, $p.Vk, $p.Mods, $flags, $p.PrefixVk, 0)
    }
    $hook.Context = @{ Engine = $Engine; Definitions = $Definitions }
    $hook.add_Fired({
        param($sender, $e)
        $ctx = $sender.Context
        [void](Invoke-EngineMacro $ctx.Engine $ctx.Definitions[$e.Id].Macro)
    })
    if (-not $NoStart -and -not $hook.Start()) {
        $hook.Dispose()
        throw 'Could not install the input hook.'
    }
    $hook
}

function Remove-InputHook {
    param($Hook)
    if ($null -ne $Hook) { $Hook.Dispose() }
}
