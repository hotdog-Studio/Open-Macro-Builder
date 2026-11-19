# SSH commands (ahk/commands/custom/ssh.ahk). Commands for your own servers belong in
# local/powershell/commands, which git ignores (see the readme).

<#
.SYNOPSIS
Starts a session saved in PuTTY, then brings a PuTTY window forward.
.DESCRIPTION
Starts PuTTY with -load and the session's name in double quotes; PuTTY must be installed so that the name putty starts it. Then waits up to 15 seconds until PuTTY has a visible window (at once if one is already open) and activates the topmost PuTTY window, or the bottom one when a PuTTY window is already active. When other PuTTY windows were open before, the window that comes forward may be one of those rather than the new session's.
.PARAMETER Name
The name of a saved session, as PuTTY's Saved Sessions list shows it. Spaces in the name are fine.
.EXAMPLE
LoadPuttySession 'my-server'
.EXAMPLE
LoadPuttySession $Macro.Name
#>
function LoadPuttySession {
    param([string]$Name)
    Start-Program 'putty' "-load `"$Name`""
    $windows = Wait-ProcessWindow 'putty.exe' 15
    # Test-WindowActive with no WinTitle gives the handle of the active window, whatever it is.
    $target = Select-WindowToActivate $windows (Test-WindowActive)
    if ($null -ne $target) { [void](Set-ActiveWindow $target) }
}

# Name a macro, or describe it, after a saved PuTTY session.

function SshMacroName { param($Macro) LoadPuttySession $Macro.Name }
function SshMacroDescription { param($Macro) LoadPuttySession $Macro.Description }

# Example: opens an SSH session with Windows' own ssh client in a new console window. Copy it for
# each server, with your own user and host.
function SshExample { param($Macro) Start-Program 'ssh' 'user@server.example.com' }
