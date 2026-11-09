param([string[]]$ExcludeTag = @())
Import-Module Pester -MinimumVersion 5.0 -Force
$c = New-PesterConfiguration
$c.Run.Path = $PSScriptRoot
$c.Run.Exit = $true
$c.Output.Verbosity = 'Detailed'
$c.Filter.ExcludeTag = $ExcludeTag
Invoke-Pester -Configuration $c
