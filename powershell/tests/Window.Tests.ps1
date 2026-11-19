BeforeAll { . "$PSScriptRoot\..\lib\Native.ps1"; . "$PSScriptRoot\..\lib\Pump.ps1"; . "$PSScriptRoot\..\lib\Window.ps1"; . "$PSScriptRoot\..\commands\helper.ps1" }
Describe 'Select-WindowToActivate' {
    BeforeAll { $w = [IntPtr[]]@([IntPtr]10, [IntPtr]20, [IntPtr]30) }
    It 'returns null for no windows' { Select-WindowToActivate @() ([IntPtr]10) | Should -BeNullOrEmpty }
    It 'returns the top window when none is foreground' { Select-WindowToActivate $w ([IntPtr]99) | Should -Be ([IntPtr]10) }
    It 'returns the bottom window when one is foreground' { Select-WindowToActivate $w ([IntPtr]20) | Should -Be ([IntPtr]30) }
}
Describe 'Get-ProcessWindow' {
    It 'returns an empty array for a process that is not running' { $r = Get-ProcessWindow 'definitely-not-running.exe'; ,$r | Should -BeOfType [System.Array]; $r.Count | Should -Be 0 }
}
Describe 'Get-AppWindow' {
    BeforeAll { . "$PSScriptRoot\..\lib\Interop.ps1"; . "$PSScriptRoot\..\lib\WinTitle.ps1" }
    It 'returns the frame windows that carry the app''s application id, topmost first, whatever their titles' {
        Mock Find-Window { , [IntPtr[]]@([IntPtr]5, [IntPtr]6, [IntPtr]7) } -ParameterFilter { $WinTitle -eq 'ahk_class ApplicationFrameWindow' -and $All }
        Mock Get-WindowAppId { @{ 5 = 'Some.App_abc!App'; 6 = 'Other.App_xyz!App'; 7 = 'some.app_ABC!app' }[[int]$Hwnd] }
        $r = Get-AppWindow 'Some.App_abc!App'
        , $r | Should -BeOfType [System.Array]
        $r -join ',' | Should -Be '5,7'
    }
    It 'returns an empty array when no frame carries the id' {
        Mock Find-Window { , [IntPtr[]]@([IntPtr]6) } -ParameterFilter { $All }
        Mock Get-WindowAppId { 'Other.App_xyz!App' }
        $r = Get-AppWindow 'Some.App_abc!App'
        , $r | Should -BeOfType [System.Array]
        $r.Count | Should -Be 0
    }
    It 'reads no application id from a window that has none' {
        Get-WindowAppId ([IntPtr]::Zero) | Should -Be ''
    }
}
Describe 'ActivateOrOpen' {
    It 'starts the program only when no window exists' {
        Mock Invoke-WindowActivation { $false }; Mock Start-Program {}; Mock Wait-ProcessWindow { @() }
        ActivateOrOpen 'x.exe' 'x' ''
        Should -Invoke Start-Program -Times 1 -Exactly -ParameterFilter { $Program -eq 'x' }
    }
    It 'does not start the program when a window exists' {
        Mock Invoke-WindowActivation { $true }; Mock Start-Program {}
        ActivateOrOpen 'x.exe' 'x' ''
        Should -Invoke Start-Program -Times 0 -Exactly
    }
}
Describe 'window activation' -Tag Integration {
    # Character Map, not Notepad: on Windows 11 the Store Notepad makes Start-Process -PassThru throw.
    It 'finds and activates a Character Map window' {
        $p = Start-Process charmap -PassThru
        try {
            $w = Wait-ProcessWindow 'charmap.exe' 10
            $w.Count | Should -BeGreaterThan 0
            Set-ActiveWindow $w[0] | Should -BeTrue
            [Macropad.Native]::GetForegroundWindow() | Should -Be $w[0]
        } finally { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
}
