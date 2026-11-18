// A program stand-in for the end-to-end test (powershell\tests\EndToEnd.Tests.ps1). The test compiles
// it once per run and copies it under the names of the programs a command starts with arguments
// (chrome.exe, putty.exe, ssh.exe, e2eapp.exe) into a folder it puts first on the macropad's PATH, so a
// command that runs "chrome.exe <address>" starts this instead of a real Chrome.
//
// It writes one line to launches.log in the folder OMB_E2E_DIR names: its own path, the name of the
// process that started it (a command that went through cmd.exe shows cmd.exe there), and the command
// line it was given. It shows no window and exits: the windows a command brings forward are stand-ins
// that the test keeps open for the whole run (ahk\tests\e2e\standin.ahk running as chrome.exe, ...),
// so no window opens and closes per case.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

public static class OmbE2eLauncher
{
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_BASIC_INFORMATION { public IntPtr Reserved1; public IntPtr PebBaseAddress; public IntPtr Reserved2a; public IntPtr Reserved2b; public IntPtr UniqueProcessId; public IntPtr InheritedFromUniqueProcessId; }
    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(IntPtr process, int infoClass, ref PROCESS_BASIC_INFORMATION info, int size, out int returned);

    // The file name of the process that started this one, or "?" when it has already exited.
    private static string ParentName()
    {
        try
        {
            PROCESS_BASIC_INFORMATION info = new PROCESS_BASIC_INFORMATION();
            int returned;
            if (NtQueryInformationProcess(Process.GetCurrentProcess().Handle, 0, ref info, Marshal.SizeOf(info), out returned) != 0) return "?";
            return Process.GetProcessById(info.InheritedFromUniqueProcessId.ToInt32()).ProcessName + ".exe";
        }
        catch (Exception) { return "?"; }
    }

    public static int Main()
    {
        string dir = Environment.GetEnvironmentVariable("OMB_E2E_DIR");
        if (string.IsNullOrEmpty(dir)) return 2;
        string self = Assembly.GetEntryAssembly().Location;
        File.AppendAllText(Path.Combine(dir, "launches.log"), self + "\t" + ParentName() + "\t" + Environment.CommandLine + "\n");
        return 0;
    }
}
