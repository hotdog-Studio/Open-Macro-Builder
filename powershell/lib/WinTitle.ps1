# Finding windows
# AHK WinTitle: parsing ('Title ahk_class X ahk_exe Y ahk_id Z ahk_pid N', or 'A' for the active
# window), matching (AHK v2 defaults: title contains, case-sensitive title and class,
# case-insensitive ahk_exe) and window queries.

function ConvertFrom-WinTitle {
    param([AllowEmptyString()][string]$WinTitle)
    $c = [pscustomobject]@{ Title = ''; Class = ''; Exe = ''; Id = [IntPtr]::Zero; Pid = 0; Active = $false }
    if ($WinTitle.Trim() -eq 'A') { $c.Active = $true; return $c }
    $tokens = @([regex]::Matches($WinTitle, '\bahk_(class|exe|id|pid)\b'))
    if ($tokens.Count -eq 0) { $c.Title = $WinTitle.Trim(); return $c }
    $c.Title = $WinTitle.Substring(0, $tokens[0].Index).Trim()
    for ($n = 0; $n -lt $tokens.Count; $n++) {
        $start = $tokens[$n].Index + $tokens[$n].Length
        $end = $WinTitle.Length
        if ($n + 1 -lt $tokens.Count) { $end = $tokens[$n + 1].Index }
        $value = $WinTitle.Substring($start, $end - $start).Trim()
        switch ($tokens[$n].Groups[1].Value) {
            'class' { $c.Class = $value }
            'exe' { $c.Exe = $value }
            'id' {
                if ($value -match '^0x([0-9A-Fa-f]+)$') { $c.Id = [IntPtr][Convert]::ToInt64($Matches[1], 16) }
                else { $c.Id = [IntPtr][long]$value }
            }
            'pid' { $c.Pid = [int]$value }
        }
    }
    $c
}

<#
.SYNOPSIS
Reads a window's title, class, program and process id. It stands in for AutoHotkey's WinGetTitle, WinGetClass, WinGetPID, WinGetProcessName, WinGetProcessPath and WinGetID.
.DESCRIPTION
Gathers the facts about one window into one object. Take the window handle from Find-Window, Test-WindowActive or Get-MousePosition. With the handle 0 ([IntPtr]::Zero) the fields come back empty and Visible is False.
.PARAMETER Hwnd
The window handle of the window to read: the number Windows uses to name one window, as Find-Window, Test-WindowActive and Get-MousePosition return it. Leaving it out raises an error.
.OUTPUTS
One object with the fields Hwnd (the handle), Title (the text in the title bar), Class (the window's class name, a name for the kind of window the program made), Pid (the process id, the number Windows gives the running program), Exe (the program's file name such as notepad.exe), Path (its full path) and Visible (True when the window is shown). Exe and Path are empty when the program cannot be looked up.
.EXAMPLE
$window = Find-Window 'ahk_exe notepad.exe'
Get-WindowInfo $window
.EXAMPLE
(Get-WindowInfo (Get-MousePosition).Window).Exe
#>
function Get-WindowInfo {
    param([IntPtr]$Hwnd)
    $windowPid = [Macropad.WindowApi]::ProcessId($Hwnd)
    $path = [Macropad.WindowApi]::ProcessPath($windowPid)
    $exe = ''
    if ($path) { $exe = [System.IO.Path]::GetFileName($path) }
    [pscustomobject]@{
        Hwnd    = $Hwnd
        Title   = [Macropad.WindowApi]::Title($Hwnd)
        Class   = [Macropad.WindowApi]::ClassName($Hwnd)
        Pid     = $windowPid
        Exe     = $exe
        Path    = $path
        Visible = [Macropad.WindowApi]::Visible($Hwnd)
    }
}

# Pure: does the window described by $Info satisfy $Criteria? $MatchMode is 1 (starts with),
# 2 (contains), 3 (exact) or 'RegEx', applied to the title case-sensitively.
function Test-WindowMatch {
    param($Info, $Criteria, $MatchMode = 2)
    $regex = "$MatchMode" -eq 'RegEx'
    if ($Criteria.Title) {
        $title = [string]$Info.Title
        $ok = switch ("$MatchMode") {
            '1' { $title.StartsWith($Criteria.Title, [StringComparison]::Ordinal) }
            '3' { $title -ceq $Criteria.Title }
            'RegEx' { $title -cmatch $Criteria.Title }
            default { $title.Contains($Criteria.Title) }
        }
        if (-not $ok) { return $false }
    }
    if ($Criteria.Class) {
        if ($regex) { if ($Info.Class -cnotmatch $Criteria.Class) { return $false } }
        elseif ($Info.Class -cne $Criteria.Class) { return $false }
    }
    if ($Criteria.Exe) {
        if ($Criteria.Exe.Contains('\')) { if ($Info.Path -ine $Criteria.Exe) { return $false } }
        elseif ($Info.Exe -ine $Criteria.Exe) { return $false }
    }
    if ($Criteria.Id -ne [IntPtr]::Zero -and $Info.Hwnd -ne $Criteria.Id) { return $false }
    if ($Criteria.Pid -ne 0 -and $Info.Pid -ne $Criteria.Pid) { return $false }
    $true
}

<#
.SYNOPSIS
Finds a window by its title, program or class and gives its handle. It stands in for AutoHotkey's WinExist and WinGetList.
.DESCRIPTION
Looks through the visible top-level windows (the main windows of programs, topmost first) for one that fits the WinTitle, and returns its window handle: the number Windows uses to name one window, which the other window functions accept. A WinTitle string is text that describes a window. It is part of the window's title, optionally followed by any of these words, each with a value: ahk_exe (the program's file name such as notepad.exe, or its full path), ahk_class (the window's class name, a name for the kind of window the program made), ahk_id (a window handle, in decimal or as 0x and hex digits) and ahk_pid (a process id, the number Windows gives a running program). The title part comes first. Every part that is given must fit. 'A' alone means the active window, the one that has the keyboard. By default the title only has to appear somewhere in the window's title; the title and the class are case-sensitive and the program name is not. A WinTitle with ahk_id finds the window even when it is hidden.
.PARAMETER WinTitle
Describes the window: part of its title, then optionally ahk_exe, ahk_class, ahk_id and ahk_pid with a value each, for example 'Untitled', 'ahk_exe notepad.exe' or 'Report ahk_exe winword.exe'; or 'A' for the active window. Leaving it out, or '', puts no condition on the window, so the first visible window fits.
.PARAMETER All
Give every window that fits, as a list, instead of only the first.
.PARAMETER IncludeHidden
Look at hidden windows too. Windows that are not shown on the screen are skipped otherwise.
.PARAMETER MatchMode
How the title part is compared with a window's title: 2 means it appears anywhere in the title, 1 that the title starts with it, 3 that the title is exactly it, and 'RegEx' that it is a regular expression (a pattern such as 'Report \d+'). With 'RegEx' the ahk_class value is a pattern too. Case counts in every mode.
.OUTPUTS
The window handle of the first window that fits, or 0 ([IntPtr]::Zero) when none does; with -All, a list of the handles of every window that fits, empty when none does. Compare a single handle with -ne [IntPtr]::Zero, because an if treats 0 as true.
.EXAMPLE
$window = Find-Window 'ahk_exe notepad.exe'
if ($window -ne [IntPtr]::Zero) { Switch-Window $window }
.EXAMPLE
(Find-Window 'ahk_exe chrome.exe' -All).Count
#>
function Find-Window {
    param([AllowEmptyString()][string]$WinTitle, [switch]$All, [switch]$IncludeHidden, $MatchMode = 2)
    $c = ConvertFrom-WinTitle $WinTitle
    if ($c.Active) { $candidates = @([Macropad.WindowApi]::Foreground()) }
    elseif ($c.Id -ne [IntPtr]::Zero) { $candidates = @($c.Id) | Where-Object { [Macropad.WindowApi]::Exists($_) } }
    else { $candidates = [Macropad.WindowApi]::TopLevel() }

    # With ahk_exe, keep only that program's windows before reading any titles.
    $pids = $null
    if ($c.Exe) {
        if ($c.Exe.Contains('\')) { $procs = Get-Process | Where-Object { $_.Path -and $_.Path -ieq $c.Exe } }
        else { $procs = Get-Process -Name ($c.Exe -replace '\.exe$', '') -ErrorAction SilentlyContinue }
        $pids = @($procs | ForEach-Object { $_.Id })
    }
    $skipHidden = -not $IncludeHidden -and $c.Id -eq [IntPtr]::Zero

    $found = [System.Collections.Generic.List[IntPtr]]::new()
    foreach ($h in @($candidates)) {
        if ($h -eq [IntPtr]::Zero) { continue }
        if ($skipHidden -and -not [Macropad.WindowApi]::Visible($h)) { continue }
        if ($null -ne $pids -and $pids -notcontains [Macropad.WindowApi]::ProcessId($h)) { continue }
        if (Test-WindowMatch (Get-WindowInfo $h) $c $MatchMode) {
            if (-not $All) { return $h }
            $found.Add($h)
        }
    }
    if ($All) { return , $found.ToArray() }
    [IntPtr]::Zero
}

<#
.SYNOPSIS
Tells whether the active window fits a WinTitle. It stands in for AutoHotkey's WinActive.
.DESCRIPTION
The active window is the one that has the keyboard. This looks at that window only and compares it with the WinTitle in the way Find-Window does. It gives the window's handle (the number Windows uses to name one window) when it fits and 0 when it does not, so compare the result with [IntPtr]::Zero instead of using it as a plain yes or no.
.PARAMETER WinTitle
A WinTitle string, which is text that describes a window, such as 'ahk_exe notepad.exe' or part of a title such as 'Untitled'; Find-Window lists every form. Leaving it out, or '', fits any active window.
.PARAMETER MatchMode
How the title part is compared with the window's title: 2 means it appears anywhere in the title, 1 that the title starts with it, 3 that the title is exactly it, and 'RegEx' that it is a regular expression. Case counts in every mode.
.OUTPUTS
The window handle of the active window when it fits the WinTitle; 0 ([IntPtr]::Zero) when it does not or when no window is active. An if treats 0 as true, so compare with -ne [IntPtr]::Zero.
.EXAMPLE
if ((Test-WindowActive 'ahk_exe notepad.exe') -ne [IntPtr]::Zero) { Send-Text 'hello' }
#>
function Test-WindowActive {
    param([AllowEmptyString()][string]$WinTitle, $MatchMode = 2)
    $fg = [Macropad.WindowApi]::Foreground()
    if ($fg -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
    if (Test-WindowMatch (Get-WindowInfo $fg) (ConvertFrom-WinTitle $WinTitle) $MatchMode) { return $fg }
    [IntPtr]::Zero
}
