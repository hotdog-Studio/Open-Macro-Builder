# Compiles every lib/cs/*.cs file into one in-memory assembly: one extra compile at startup,
# not one per feature. Dot-source after Native.ps1 (it loads WinForms and System.Drawing).
# A second dot-source in the same session is a no-op.

if (-not ('Macropad.Interop' -as [type])) {
    Add-Type -Path (Get-ChildItem "$PSScriptRoot\cs\*.cs").FullName -ReferencedAssemblies System.Windows.Forms, System.Drawing
}
