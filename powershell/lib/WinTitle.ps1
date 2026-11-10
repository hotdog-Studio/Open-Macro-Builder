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

# AHK WinExist / WinGetList: the first matching window (or [IntPtr]::Zero); every match with -All.
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

# AHK WinActive: the foreground window when it matches, else [IntPtr]::Zero.
function Test-WindowActive {
    param([AllowEmptyString()][string]$WinTitle, $MatchMode = 2)
    $fg = [Macropad.WindowApi]::Foreground()
    if ($fg -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
    if (Test-WindowMatch (Get-WindowInfo $fg) (ConvertFrom-WinTitle $WinTitle) $MatchMode) { return $fg }
    [IntPtr]::Zero
}
