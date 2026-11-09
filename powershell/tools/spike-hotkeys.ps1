# Manual check of the hotkey mechanics: the low-level hook that swallows ScrollLock (Fn)
# and reports its down/up, and RegisterHotKey for F13.
# Exit the AutoHotkey macropad first: its keyboard hook swallows these keys.
# Usage: powershell -NoProfile -File powershell\tools\spike-hotkeys.ps1 [-Seconds 30]
param([int]$Seconds = 30)

. "$PSScriptRoot\..\lib\Native.ps1"

function Get-ScrollLockState { [Macropad.Native]::GetKeyState(0x91) -band 1 }

$hk = [Macropad.HotkeyWindow]::new()
try {
    if (-not $hk.HookFnKey(0x91)) {
        Write-Host 'Could not hook ScrollLock'
        exit 1
    }
    if (-not $hk.Register(0, [Macropad.Native]::MOD_NOREPEAT, 0x7C)) {
        Write-Host 'Could not register hotkey id 0 (F13)'
        exit 1
    }

    $hk.Context = @{ Start = [DateTime]::Now }
    $hk.add_FnDown({
        param($sender, $e)
        $sender.Context.Start = [DateTime]::Now
        Write-Host "Fn down (toggle state before: $(Get-ScrollLockState))"
    })
    $hk.add_FnUp({
        param($sender, $e)
        $ms = [int]([DateTime]::Now - $sender.Context.Start).TotalMilliseconds
        Write-Host "Fn up after $ms ms (toggle state after: $(Get-ScrollLockState))"
    })
    $hk.add_HotkeyPressed({
        param($sender, $e)
        if ($e.Id -eq 0) { Write-Host 'F13 down' }
    })

    $quit = New-Object System.Windows.Forms.Timer
    $quit.Interval = $Seconds * 1000
    $quit.add_Tick({ param($sender, $e) $sender.Stop(); [System.Windows.Forms.Application]::Exit() })
    $quit.Start()

    Write-Host "Listening for $Seconds s: hold ScrollLock, press F13 while holding, release."
    [System.Windows.Forms.Application]::Run()
}
finally {
    $hk.Dispose()
}
