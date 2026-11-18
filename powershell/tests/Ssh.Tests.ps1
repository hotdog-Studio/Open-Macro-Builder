# The SSH commands (powershell/commands/custom/ssh.ps1), with every function that starts a program
# or looks at windows mocked, so nothing starts and no window moves.
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native', 'Interop', 'Pump', 'Window', 'WinTitle') { . "$ps\lib\$f.ps1" }
    . "$ps\commands\custom\ssh.ps1"
}
Describe 'LoadPuttySession' {
    BeforeEach { Mock Start-Program {}; Mock Set-ActiveWindow { $true }; Mock Test-WindowActive { [IntPtr]99 } }
    It 'starts PuTTY with the session name in double quotes and waits up to 15 seconds for its window' {
        Mock Wait-ProcessWindow { , [IntPtr[]]@([IntPtr]5, [IntPtr]7) }
        LoadPuttySession 'my server'
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'putty' -and $Arguments -eq '-load "my server"' }
        Should -Invoke Wait-ProcessWindow -Times 1 -Exactly -ParameterFilter { $Exe -eq 'putty.exe' -and $TimeoutSeconds -eq 15 }
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]5 }
    }
    It 'brings the bottom PuTTY window forward when a PuTTY window is already active' {
        Mock Wait-ProcessWindow { , [IntPtr[]]@([IntPtr]5, [IntPtr]7) }
        Mock Test-WindowActive { [IntPtr]5 }
        LoadPuttySession 'nas'
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]7 }
    }
    It 'activates nothing when no PuTTY window appears' {
        Mock Wait-ProcessWindow { , [IntPtr[]]@() }
        LoadPuttySession 'nas'
        Should -Invoke Set-ActiveWindow -Times 0 -Exactly
    }
}
Describe 'SshMacroDescription' {
    It 'opens the PuTTY session named in the macro description' {
        Mock LoadPuttySession {}
        SshMacroDescription ([pscustomobject]@{ Name = 'x'; Description = 'my server' })
        Should -Invoke LoadPuttySession -Times 1 -Exactly -ParameterFilter { $Name -eq 'my server' }
    }
}
