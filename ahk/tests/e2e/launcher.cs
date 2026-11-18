// A program stand-in for the end-to-end test (powershell\tests\EndToEnd.Tests.ps1). The test compiles
// it once per run and copies it under the names of the programs a command starts with arguments
// (chrome.exe, putty.exe, ssh.exe) into a folder it puts first on the macropad's PATH, so a command
// that runs "chrome.exe <address>" starts this instead of a real Chrome.
//
// It writes its own path and the command line it was given to launches.log in the folder OMB_E2E_DIR
// names, then starts
// the AutoHotkey stand-in window (ahk\tests\e2e\standin.ahk) under a copy of AutoHotkey named like
// itself, so the window that appears belongs to a process called chrome.exe (or putty.exe, ...). It
// is needed because AutoHotkey itself would read the first argument as the path of a script.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

public static class OmbE2eLauncher
{
    public static int Main()
    {
        string dir = Environment.GetEnvironmentVariable("OMB_E2E_DIR");
        string script = Environment.GetEnvironmentVariable("OMB_E2E_STANDIN");
        if (string.IsNullOrEmpty(dir) || string.IsNullOrEmpty(script)) return 2;
        string self = Assembly.GetEntryAssembly().Location;
        string exe = Path.GetFileName(self);
        string name = Path.GetFileNameWithoutExtension(exe);
        string id = DateTime.UtcNow.Ticks.ToString();
        string log = Path.Combine(dir, "launch-" + name + "-" + id + ".log");
        File.AppendAllText(Path.Combine(dir, "launches.log"), self + "\t" + log + "\t" + Environment.CommandLine + "\n");
        // A program that starts and shows no window: given --no-window, or while the test has left a
        // file nowindow-<name> in the folder.
        if (Environment.CommandLine.Contains("--no-window") || File.Exists(Path.Combine(dir, "nowindow-" + name))) return 0;

        ProcessStartInfo start = new ProcessStartInfo(Path.Combine(Path.Combine(dir, "bin"), exe));
        start.Arguments = "\"" + script + "\" \"" + log + "\" \"" + name + " (started by a command)\" 40 380 420 160";
        start.UseShellExecute = false;
        Process.Start(start);
        return 0;
    }
}
