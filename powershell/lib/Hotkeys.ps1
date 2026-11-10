# AHK-style hotkeys for config.ps1 (define Get-MacropadHotkeys returning Hotkey definitions).
# Fired hotkeys run through Invoke-EngineMacro, so the macro guard covers them and their errors
# are reported like macro errors.

# -IfWinActive / -IfWinNotActive take a WinTitle (AHK #HotIfWinActive / #HotIfWinNotActive).
function Hotkey {
    param([Parameter(Mandatory)][string]$Spec, [Parameter(Mandatory)]$Action, [string]$IfWinActive = '', [string]$IfWinNotActive = '')
    if ($IfWinActive -and $IfWinNotActive) { throw 'Use either IfWinActive or IfWinNotActive, not both.' }
    [pscustomobject]@{
        Kind           = 'Hotkey'
        Spec           = $Spec
        Parsed         = ConvertFrom-AhkHotkey $Spec
        Macro          = Macro $Action $Spec
        IfWinActive    = $IfWinActive
        IfWinNotActive = $IfWinNotActive
    }
}

# Distinct (WinTitle, Negate) pairs in first-seen order, numbered from 1.
function Get-HotkeyContexts {
    param([object[]]$Definitions)
    $contexts = [System.Collections.Generic.List[object]]::new()
    foreach ($d in @($Definitions)) {
        $key = Get-HotkeyContextKey $d
        if ($null -eq $key) { continue }
        if (@($contexts | Where-Object { $_.WinTitle -ceq $key.WinTitle -and $_.Negate -eq $key.Negate }).Count -gt 0) { continue }
        $contexts.Add([pscustomobject]@{ Id = $contexts.Count + 1; WinTitle = $key.WinTitle; Negate = $key.Negate })
    }
    , $contexts.ToArray()
}

function Get-HotkeyContextKey {
    param($Definition)
    if ($Definition.IfWinActive) { return @{ WinTitle = $Definition.IfWinActive; Negate = $false } }
    if ($Definition.IfWinNotActive) { return @{ WinTitle = $Definition.IfWinNotActive; Negate = $true } }
    $null
}

# The context id a definition belongs to (0 = always active).
function Get-HotkeyContextId {
    param($Definition, [object[]]$Contexts)
    $key = Get-HotkeyContextKey $Definition
    if ($null -eq $key) { return 0 }
    foreach ($c in @($Contexts)) { if ($c.WinTitle -ceq $key.WinTitle -and $c.Negate -eq $key.Negate) { return $c.Id } }
    0
}

# Turns each context on or off for the window described by $Info ($null matches nothing).
function Update-HotkeyContexts {
    param($Hook, [object[]]$Contexts, $Info)
    foreach ($c in @($Contexts)) {
        $isMatch = $false
        if ($null -ne $Info) { $isMatch = Test-WindowMatch $Info (ConvertFrom-WinTitle $c.WinTitle) }
        $Hook.SetContextActive($c.Id, ($isMatch -xor $c.Negate))
    }
}

function Get-ForegroundInfo {
    $fg = [Macropad.WindowApi]::Foreground()
    if ($fg -eq [IntPtr]::Zero) { return $null }
    Get-WindowInfo $fg
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

    $contexts = Get-HotkeyContexts $Definitions
    $hook = [Macropad.InputHook]::new()
    for ($i = 0; $i -lt $Definitions.Count; $i++) {
        $d = $Definitions[$i]
        if ($d.Kind -ne 'Hotkey') { continue }
        $p = $d.Parsed
        $flags = [int]$p.Wildcard + 2 * [int]$p.Passthrough + 4 * [int]$p.KeyUp
        $hook.AddHotkey($i, $p.Vk, $p.Mods, $flags, $p.PrefixVk, (Get-HotkeyContextId $d $contexts))
    }

    # The watcher keeps the contexts in step with the foreground window.
    $watcher = [Macropad.ForegroundWatcher]::new()
    $watcher.Context = @{ Hook = $hook; Contexts = $contexts }
    $watcher.add_Changed({
        param($sender, $e)
        $ctx = $sender.Context
        Update-HotkeyContexts $ctx.Hook $ctx.Contexts (Get-ForegroundInfo)
    })

    $hook.Context = @{ Engine = $Engine; Definitions = $Definitions; Contexts = $contexts; Watcher = $watcher }
    $hook.add_Fired({
        param($sender, $e)
        $ctx = $sender.Context
        [void](Invoke-EngineMacro $ctx.Engine $ctx.Definitions[$e.Id].Macro)
    })
    Update-HotkeyContexts $hook $contexts (Get-ForegroundInfo)
    if (-not $NoStart -and -not $hook.Start()) {
        Remove-InputHook $hook
        throw 'Could not install the input hook.'
    }
    $hook
}

function Remove-InputHook {
    param($Hook)
    if ($null -eq $Hook) { return }
    if ($Hook.Context -is [hashtable] -and $null -ne $Hook.Context.Watcher) { $Hook.Context.Watcher.Dispose() }
    $Hook.Dispose()
}
