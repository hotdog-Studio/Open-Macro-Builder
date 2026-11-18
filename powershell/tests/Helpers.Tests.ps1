# The launch and message helpers of powershell\commands\helper.ps1, with every function that starts a
# program, looks at windows or shows a box mocked, so nothing starts and no window moves.
# ActivateOrOpen is in Window.Tests.ps1, Open-ExplorerWindow in Commands.Tests.ps1.
BeforeAll {
    $ps = Split-Path $PSScriptRoot -Parent
    foreach ($f in 'Native', 'Interop', 'Pump', 'Window', 'WinTitle') { . "$ps\lib\$f.ps1" }
    . "$ps\commands\helper.ps1"
}
Describe 'Open' {
    BeforeEach { Mock Start-Program {}; Mock Set-ActiveWindow { $true } }
    It 'starts the program with its arguments and activates the topmost of its windows' {
        Mock Wait-ProcessWindow { , [IntPtr[]]@([IntPtr]5, [IntPtr]7) }
        Open 'notepad.exe' 'notepad' -Arguments 'C:\Users\Public\notes.txt'
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'notepad' -and $Arguments -eq 'C:\Users\Public\notes.txt' }
        Should -Invoke Wait-ProcessWindow -Times 1 -Exactly -ParameterFilter { $Exe -eq 'notepad.exe' -and $TimeoutSeconds -eq 5 }
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]5 }
    }
    It 'activates nothing when no window appears' {
        Mock Wait-ProcessWindow { , [IntPtr[]]@() }
        Open 'notepad.exe' 'notepad'
        Should -Invoke Start-Program -Times 1 -Exactly
        Should -Invoke Set-ActiveWindow -Times 0 -Exactly
    }
}
Describe 'EnsureActiveOrOpen' {
    BeforeEach { Mock Start-Program {}; Mock Set-ActiveWindow { $true }; Mock Test-WindowActive { [IntPtr]99 } }
    It 'starts the program when it has no window and activates the window that appears' {
        Mock Get-ProcessWindow { , [IntPtr[]]@() }
        Mock Wait-ProcessWindow { , [IntPtr[]]@([IntPtr]5) }
        EnsureActiveOrOpen 'x.exe' 'x' -Arguments '--a' | Should -Be $true
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'x' -and $Arguments -eq '--a' }
        Should -Invoke Wait-ProcessWindow -Times 1 -Exactly -ParameterFilter { $TimeoutSeconds -eq 5 }
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]5 }
    }
    It 'returns False and activates nothing when no window appears' {
        Mock Get-ProcessWindow { , [IntPtr[]]@() }
        Mock Wait-ProcessWindow { , [IntPtr[]]@() }
        EnsureActiveOrOpen 'x.exe' 'x' | Should -Be $false
        Should -Invoke Set-ActiveWindow -Times 0 -Exactly
    }
    It 'returns True and changes nothing when one of its windows is already active' {
        Mock Get-ProcessWindow { , [IntPtr[]]@([IntPtr]5, [IntPtr]7) }
        Mock Test-WindowActive { [IntPtr]7 }
        EnsureActiveOrOpen 'x.exe' 'x' | Should -Be $true
        Should -Invoke Start-Program -Times 0 -Exactly
        Should -Invoke Set-ActiveWindow -Times 0 -Exactly
    }
    It 'returns False when Windows does not let its window come to the front' {
        Mock Get-ProcessWindow { , [IntPtr[]]@([IntPtr]5) }
        Mock Set-ActiveWindow { $false }
        EnsureActiveOrOpen 'x.exe' 'x' | Should -Be $false
        Should -Invoke Set-ActiveWindow -Times 1 -Exactly -ParameterFilter { $Hwnd -eq [IntPtr]5 }
    }
}
Describe 'Script helpers' {
    BeforeEach { Mock Start-Program {} }
    It 'RunPythonScript quotes the path and adds the arguments' {
        RunPythonScript 'C:\My Scripts\backup.py' -Arguments '--quick'
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'python' -and $Arguments -eq '"C:\My Scripts\backup.py" --quick' }
    }
    It 'RunPythonScript without arguments' {
        RunPythonScript 'C:\My Scripts\backup.py'
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'python' -and $Arguments -eq '"C:\My Scripts\backup.py"' }
    }
    It 'RunPowerShellScript runs Windows PowerShell without the profile and with the policy bypassed' {
        RunPowerShellScript 'C:\My Scripts\cleanup.ps1' -Arguments '-Force'
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'powershell' -and $Arguments -eq '-NoProfile -ExecutionPolicy Bypass -File "C:\My Scripts\cleanup.ps1" -Force' }
    }
    It 'RunBatchScript starts the file with its arguments' {
        RunBatchScript 'C:\My Scripts\build.bat' -Arguments '0'
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'C:\My Scripts\build.bat' -and $Arguments -eq '0' }
    }
}
Describe 'Message helpers' {
    BeforeEach { Mock Show-MessageBox {} }
    It 'Message shows the description with the name as the title' {
        Message ([pscustomobject]@{ Name = 'Backup'; Description = 'Copies the files' })
        Should -Invoke Show-MessageBox -Times 1 -Exactly -ParameterFilter { $Text -eq 'Copies the files' -and $Title -eq 'Backup' }
    }
    It 'ReplaceMe asks for the macro to be replaced' {
        ReplaceMe ([pscustomobject]@{ Name = 'Key 5'; Description = 'x' })
        Should -Invoke Show-MessageBox -Times 1 -Exactly -ParameterFilter { $Text -eq 'Replace Key 5 with your own!' -and $Title -eq 'Key 5' }
    }
}
