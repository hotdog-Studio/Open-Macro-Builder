BeforeAll {
    foreach ($f in 'Native', 'Interop', 'WinTitle') { . "$PSScriptRoot\..\lib\$f.ps1" }
    $info = [pscustomobject]@{ Hwnd = [IntPtr]5; Title = 'Inbox - Gmail - Google Chrome'; Class = 'Chrome_WidgetWin_1'; Pid = 10; Exe = 'chrome.exe'; Path = 'C:\Program Files\Google\Chrome\Application\chrome.exe'; Visible = $true }
}
Describe 'ConvertFrom-WinTitle' {
    It 'splits title and criteria' { $c = ConvertFrom-WinTitle 'Untitled - Notepad ahk_exe notepad.exe'; $c.Title | Should -Be 'Untitled - Notepad'; $c.Exe | Should -Be 'notepad.exe' }
    It 'reads several criteria without a title' { $c = ConvertFrom-WinTitle 'ahk_class Chrome_WidgetWin_1 ahk_exe chrome.exe'; $c.Title | Should -Be ''; $c.Class | Should -Be 'Chrome_WidgetWin_1'; $c.Exe | Should -Be 'chrome.exe' }
    It 'reads ids and pids' { (ConvertFrom-WinTitle 'ahk_id 0x1F').Id | Should -Be ([IntPtr]31); (ConvertFrom-WinTitle 'ahk_pid 42').Pid | Should -Be 42 }
    It 'reads the active window' { (ConvertFrom-WinTitle 'A').Active | Should -BeTrue }
}
Describe 'Test-WindowMatch' {
    It 'matches titles by mode, case-sensitively' {
        Test-WindowMatch $info (ConvertFrom-WinTitle 'Gmail') | Should -BeTrue
        Test-WindowMatch $info (ConvertFrom-WinTitle 'gmail') | Should -BeFalse
        Test-WindowMatch $info (ConvertFrom-WinTitle 'Inbox') 1 | Should -BeTrue
        Test-WindowMatch $info (ConvertFrom-WinTitle 'Gmail') 1 | Should -BeFalse
        Test-WindowMatch $info (ConvertFrom-WinTitle 'Inbox - Gmail - Google Chrome') 3 | Should -BeTrue
        Test-WindowMatch $info (ConvertFrom-WinTitle 'Gm.il') 'RegEx' | Should -BeTrue
    }
    It 'matches exe names case-insensitively, by name or path' {
        Test-WindowMatch $info (ConvertFrom-WinTitle 'ahk_exe CHROME.EXE') | Should -BeTrue
        Test-WindowMatch $info (ConvertFrom-WinTitle 'ahk_exe C:\Program Files\Google\Chrome\Application\chrome.exe') | Should -BeTrue
    }
    It 'rejects a different class or pid' {
        Test-WindowMatch $info (ConvertFrom-WinTitle 'ahk_class Notepad') | Should -BeFalse
        Test-WindowMatch $info (ConvertFrom-WinTitle 'ahk_pid 11') | Should -BeFalse
    }
}
Describe 'Find-Window' {
    BeforeEach { $form = New-Object System.Windows.Forms.Form; $form.Text = "MacropadWinTitleTest $PID"; $form.Show() }
    AfterEach { $form.Dispose() }
    It 'finds a window by title and exe' {
        Find-Window "MacropadWinTitleTest $PID" | Should -Be $form.Handle
        Find-Window "MacropadWinTitleTest $PID ahk_exe powershell.exe" | Should -Be $form.Handle
        Get-WindowInfo $form.Handle | ForEach-Object { $_.Exe | Should -Be 'powershell.exe'; $_.Title | Should -Be "MacropadWinTitleTest $PID" }
    }
    It 'skips hidden windows unless asked or given ahk_id' {
        $form.Hide()
        Find-Window "MacropadWinTitleTest $PID" | Should -Be ([IntPtr]::Zero)
        Find-Window "MacropadWinTitleTest $PID" -IncludeHidden | Should -Be $form.Handle
        Find-Window "ahk_id $($form.Handle)" | Should -Be $form.Handle
    }
    It 'returns every match with -All' { $r = Find-Window "MacropadWinTitleTest $PID" -All; ,$r | Should -BeOfType [System.Array]; $r.Count | Should -Be 1 }
}
