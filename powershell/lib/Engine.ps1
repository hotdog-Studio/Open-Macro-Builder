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
        Busy        = $false
        GetSelected = $GetSelected
        SelectLayer = $SelectLayer
        RunMacro    = $RunMacro
        ShowOverlay = $ShowOverlay
        HideOverlay = $HideOverlay
        OnError     = $OnError
        CommandLog  = Get-EngineCommandLog
    }
}

# The end-to-end test's command log: OMB_E2E_DIR\commands.log when the test started this macropad
# (OMB_E2E and OMB_E2E_DIR both set), else '' and nothing is written. Read once, when the engine is made.
# The AutoHotkey version reads the same (CommandLogPath in ahk\lib\io.ahk).
function Get-EngineCommandLog {
    if ($env:OMB_E2E -and $env:OMB_E2E_DIR) { return Join-Path $env:OMB_E2E_DIR 'commands.log' }
    ''
}

# The name a line of the command log gives a macro's command: the function its action names, or, for an
# action that names none (a scriptblock), the macro's name. AutoHotkey gives its action's function name.
function Get-EngineCommandName {
    param($Macro)
    if ($Macro.Action -is [string] -and $Macro.Action) { return $Macro.Action }
    [string]$Macro.Name
}

# Appends one line to the command log: UTF-8 without a byte order mark, ended by a bare line feed, as the
# AutoHotkey version writes it, through a stream that shares reading and writing, since the test reads
# the file while the macropad writes it. Best effort: a line that cannot be written is dropped, and never
# stops or breaks the command.
function Write-EngineCommandLog {
    param([string]$Path, [string]$Line)
    try {
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes("$Line`n")
        $stream = [System.IO.FileStream]::new($Path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
        try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    }
    catch { $null = $_ }
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
    [void](Invoke-EngineMacro $Engine $macro)
}

# True when the exception, or one it wraps, is the cancellation Wait-Pump throws on exit.
function Test-MacroCancelled {
    param([Exception]$Exception)
    for ($ex = $Exception; $null -ne $ex; $ex = $ex.InnerException) {
        if ($ex -is [OperationCanceledException]) { return $true }
    }
    $false
}

# The one way a macro runs. While one runs (including during its pumped waits), further macro
# requests are dropped, not queued, so stale keys never replay into whatever window has focus later.
# With the end-to-end test's command log on (CommandLog), a macro that runs writes 'start <command>',
# then 'done <command>' when it has returned or 'failed <command>: <message>' (on one line) before its
# error is reported; a dropped request writes nothing, and a macro the macropad's exit cancelled only
# its start. The AutoHotkey version writes the same lines for its keys and overlay clicks
# (RunMacroAction in ahk\lib\io.ahk), but not for config.json's hotkeys and hotstrings, which here come
# through this function too. The variables have names of their own: a command runs inside this function
# and could read a plain $name.
function Invoke-EngineMacro {
    param($Engine, $Macro)
    if ($Engine.Busy) { return $false }
    $Engine.Busy = $true
    $engineCommandLog = $Engine.CommandLog
    if ($engineCommandLog) {
        $engineCommandName = Get-EngineCommandName $Macro
        Write-EngineCommandLog $engineCommandLog "start $engineCommandName"
    }
    try {
        [void](& $Engine.RunMacro $Macro)
        if ($engineCommandLog) { Write-EngineCommandLog $engineCommandLog "done $engineCommandName" }
    } catch {
        if (-not (Test-MacroCancelled $_.Exception)) {
            if ($engineCommandLog) { Write-EngineCommandLog $engineCommandLog "failed ${engineCommandName}: $($_.Exception.Message -replace '\s*\r?\n\s*', ' ')" }
            & $Engine.OnError $Macro $_
        }
    } finally {
        $Engine.Busy = $false
    }
    $true
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
        throw "Could not hook the Fn key '$fnName'."
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
