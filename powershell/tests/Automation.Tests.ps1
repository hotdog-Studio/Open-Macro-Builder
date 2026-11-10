# The delayed key and click forms (commands/custom/automation.ps1 and ahk/commands/custom/automation.ahk).
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native','Interop','Pump','Assets','Input','Model','Overlay','Window','Engine','AhkSyntax','WinTitle') { . "$ps\lib\$f.ps1" }
    . "$ps\commands\custom\automation.ps1"
    . "$PSScriptRoot\helpers\Ahk.ps1"
}
Describe 'Delayed key and click forms' {
    It '<Command> cancels its pending send when the form is opened again' -ForEach @(
        @{ Command = 'ShowDelayedKeyForm'; Name = 'MacropadDelayedKeyForm' }
        @{ Command = 'ShowDelayedClickForm'; Name = 'MacropadDelayedClickForm' }
    ) {
        try {
            & $Command $null
            $old = [System.Windows.Forms.Application]::OpenForms[$Name]
            Start-PendingTimer $old 60000 { param($sender, $e) }
            $timer = $old.Tag.PendingTimer
            & $Command $null
            $timer.Enabled | Should -BeFalse
        } finally {
            foreach ($form in @([System.Windows.Forms.Application]::OpenForms | Where-Object { $_.Name -eq $Name })) { $form.Dispose() }
        }
    }
}
Describe 'AutoHotkey delayed key form' -Tag Integration {
    It 'cancels a scheduled send when the form is opened again' {
        if (-not (Get-AhkExe)) { Set-ItResult -Skipped -Because 'AutoHotkey v2 is not installed'; return }
        $root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
        # The check script sends vkE9, a key that types nothing, which a hook here counts (and
        # swallows). A hook outside AutoHotkey sees both SendInput and SendEvent.
        $hook = [Macropad.InputHook]::new(); $hook.Context = @{ Count = 0 }
        $hook.AddHotkey(0, 0xE9, 0, 1, 0, 0)
        $hook.add_Fired({ param($sender, $e) $sender.Context.Count++ })
        if (-not $hook.Start()) { throw 'Could not install the test keyboard hook.' }
        try {
            $r = Invoke-AhkScript "$root\ahk\tests\automation_check.ahk"
            Wait-Pump 300
            $r.ExitCode | Should -Be 0 -Because $r.Err
            $r.Out.Trim() | Should -Be 'done'
            $hook.Context.Count | Should -Be 1 -Because 'only the schedule that was not followed by reopening the form may send'
        } finally { $hook.Dispose() }
    }
}
