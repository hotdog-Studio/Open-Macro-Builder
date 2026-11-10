# Runs the Pester suite, plus the tests for your own commands in local\powershell\tests when that
# folder exists (git ignores it). -Ci (the Jenkins Windows stage) writes JUnit XML to
# results/pester/test-results.xml at the repo root and leaves out the Integration tests, which
# open windows and send real keys.
param([string[]]$ExcludeTag = @(), [switch]$Ci)
Import-Module Pester -MinimumVersion 5.0 -Force
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$c = New-PesterConfiguration
$c.Run.Path = @($PSScriptRoot) + @(Join-Path $root 'local\powershell\tests' | Where-Object { Test-Path -LiteralPath $_ })
$c.Run.Exit = $true
$c.Output.Verbosity = 'Detailed'
if ($Ci) {
    $ExcludeTag = @($ExcludeTag) + 'Integration'
    $results = Join-Path $root 'results\pester'
    New-Item -ItemType Directory -Force -Path $results | Out-Null
    $c.TestResult.Enabled = $true
    $c.TestResult.OutputFormat = 'JUnitXml'
    $c.TestResult.OutputPath = Join-Path $results 'test-results.xml'
}
$c.Filter.ExcludeTag = $ExcludeTag
Invoke-Pester -Configuration $c
