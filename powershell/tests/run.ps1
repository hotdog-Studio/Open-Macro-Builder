# Runs the Pester suite. -Ci (the Jenkins Windows stage) writes JUnit XML to
# results/pester/test-results.xml at the repo root and leaves out the Integration tests, which
# open windows and send real keys.
param([string[]]$ExcludeTag = @(), [switch]$Ci)
Import-Module Pester -MinimumVersion 5.0 -Force
$c = New-PesterConfiguration
$c.Run.Path = $PSScriptRoot
$c.Run.Exit = $true
$c.Output.Verbosity = 'Detailed'
if ($Ci) {
    $ExcludeTag = @($ExcludeTag) + 'Integration'
    $results = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) 'results\pester'
    New-Item -ItemType Directory -Force -Path $results | Out-Null
    $c.TestResult.Enabled = $true
    $c.TestResult.OutputFormat = 'JUnitXml'
    $c.TestResult.OutputPath = Join-Path $results 'test-results.xml'
}
$c.Filter.ExcludeTag = $ExcludeTag
Invoke-Pester -Configuration $c
