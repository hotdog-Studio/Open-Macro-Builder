# The cases of the end-to-end test (EndToEnd.Tests.ps1): one table, run once against each macropad.
#
# A case is a hashtable:
#   Command   the command function its key runs: a command of the shared files, or one of the test's
#             own (ahk\tests\e2e\commands.ahk / .ps1), whose names start with E2e
#   File      the shared command file it belongs to ('custom\vscode'), or 'e2e' for the test's own
#   Kind      'Chord' (default): the stand-in A is active, the key is pressed, and A must receive
#             exactly the taps of Chords. 'Custom': Arrange and Assert say what happens.
#   Chords    what a Chord case must press. Left out, it is the PowerShell twin's chord, read from
#             powershell\commands (ConvertTo-KeyEvent turns it into keys on the active window's layout).
#   Source    for Chords written here: the documentation page that says these are the keys
#   Only      'ahk' or 'ps' when the case runs against one macropad only; Why says why
#   Macro     @{ name; description } for the layout entry, when the command reads them
#   Arrange, Assert, CleanUp   scriptblocks given the case's context ($ctx)
#   Covers    the fixes of fix-scripts-1-report.md / fix-scripts-2-report.md it proves, for the report

function Get-E2eCases {
    @(
        @{ Command = 'VsCodeToggleSidebar'; File = 'custom\vscode' }
    )
}

# Commands of the shared files that no case runs, each with what makes it unfit for this test.
function Get-E2eExclusions {
    @{}
}
