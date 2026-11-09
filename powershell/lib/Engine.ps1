# Mode engine: Fn held = mode 1 (overlay shown, macro keys select layers),
# otherwise mode 0 (macro keys run the selected layer's macros).
# The engine only calls the scriptblocks it is given, so tests drive it without WinForms.

function New-Engine {
    param(
        $Layout,
        [scriptblock]$GetSelected,
        [scriptblock]$SelectLayer,
        [scriptblock]$RunMacro,
        [scriptblock]$ShowOverlay,
        [scriptblock]$HideOverlay,
        [scriptblock]$OnError
    )
    [pscustomobject]@{
        Layout      = $Layout
        Mode        = 0
        GetSelected = $GetSelected
        SelectLayer = $SelectLayer
        RunMacro    = $RunMacro
        ShowOverlay = $ShowOverlay
        HideOverlay = $HideOverlay
        OnError     = $OnError
    }
}

function Invoke-EngineFn {
    param($Engine)
    $Engine.Mode = 1
    & $Engine.ShowOverlay
}

function Invoke-EngineFnRelease {
    param($Engine)
    $Engine.Mode = 0
    & $Engine.HideOverlay
}

function Invoke-EngineKey {
    param($Engine, [int]$Index)
    if (Test-NoLayers $Engine.Layout) { return }
    if ($Engine.Mode -eq 1) {
        [void](& $Engine.SelectLayer $Index)
        return
    }
    $sel = & $Engine.GetSelected
    if ($null -eq $sel -or $sel -lt 0) { return }
    $layers = @($Engine.Layout.Layers)
    if ($sel -ge $layers.Count -or $null -eq $layers[$sel]) { return }
    $macros = @($layers[$sel].Macros)
    if ($Index -lt 0 -or $Index -ge $macros.Count) { return }
    $macro = $macros[$Index]
    if ($null -eq $macro) { return }
    try {
        & $Engine.RunMacro $macro
    } catch {
        & $Engine.OnError $macro $_
    }
}

# Runs a macro's action: a function name or a scriptblock, given the macro itself.
function Invoke-Macro {
    param($Macro)
    & $Macro.Action $Macro
}

# Fn is swallowed by a low-level hook and arrives as FnDown / FnUp (see README);
# macro key i is RegisterHotKey id i. Handlers reach the engine through $Window.Context.
function Register-LayoutHotkeys {
    param($Window, $Layout, $Engine)
    $fnName = $Layout.Fn.Name
    if (-not $Window.HookFnKey([uint32](Get-VirtualKey $fnName))) {
        throw "Could not register hotkey '$fnName'. Is the AutoHotkey macropad or another instance running?"
    }
    $keys = @($Layout.Keys)
    for ($i = 0; $i -lt $keys.Count; $i++) {
        $vk = [uint32](Get-VirtualKey $keys[$i].Name)
        if (-not $Window.Register($i, [uint32][Macropad.Native]::MOD_NOREPEAT, $vk)) {
            throw "Could not register hotkey '$($keys[$i].Name)'. Is the AutoHotkey macropad or another instance running?"
        }
    }
    $Window.Context = @{ Engine = $Engine; Layout = $Layout }
    $Window.add_FnDown({ param($sender, $e) Invoke-EngineFn $sender.Context.Engine })
    $Window.add_FnUp({ param($sender, $e) Invoke-EngineFnRelease $sender.Context.Engine })
    $Window.add_HotkeyPressed({ param($sender, $e) Invoke-EngineKey $sender.Context.Engine $e.Id })
}
