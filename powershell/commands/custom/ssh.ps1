# SSH commands (ahk/commands/custom/ssh.ahk). Commands for your own servers belong in
# local/powershell/commands, which git ignores (see the readme).

# Starts a saved PuTTY session, then brings a PuTTY window forward.
function LoadPuttySession {
    param([string]$Name)
    Start-Program 'putty' "-load `"$Name`""
    $windows = Wait-ProcessWindow 'putty.exe' 15
    $target = Select-WindowToActivate $windows ([Macropad.Native]::GetForegroundWindow())
    if ($null -ne $target) { [void](Set-ActiveWindow $target) }
}

# Name a macro, or describe it, after a saved PuTTY session.
function SshMacroName { param($Macro) LoadPuttySession $Macro.Name }
function SshMacroDescription { param($Macro) LoadPuttySession $Macro.Description }

# Example: opens an SSH session with Windows' own ssh client in a new console window. Copy it for
# each server, with your own user and host.
function SshExample { param($Macro) Start-Program 'ssh' 'user@server.example.com' }
