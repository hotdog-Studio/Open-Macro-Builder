using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Macropad
{
    // Window and control Win32 calls behind the AHK window functions (WinTitle.ps1, WindowOps.ps1).
    public static class WindowApi
    {
        private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowTextLength(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern bool IsWindow(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);
        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr hObject);

        // Every top-level window in EnumWindows order (top of the Z-order first).
        public static IntPtr[] TopLevel()
        {
            List<IntPtr> found = new List<IntPtr>();
            EnumProc callback = delegate (IntPtr hWnd, IntPtr lParam) { found.Add(hWnd); return true; };
            EnumWindows(callback, IntPtr.Zero);
            GC.KeepAlive(callback);
            return found.ToArray();
        }

        public static string Title(IntPtr hWnd)
        {
            int length = GetWindowTextLength(hWnd);
            if (length <= 0) return "";
            StringBuilder sb = new StringBuilder(length + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            return sb.ToString();
        }

        public static string ClassName(IntPtr hWnd)
        {
            StringBuilder sb = new StringBuilder(256);
            GetClassName(hWnd, sb, sb.Capacity);
            return sb.ToString();
        }

        public static int ProcessId(IntPtr hWnd)
        {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            return (int)pid;
        }

        // Full image path of a process; "" when it cannot be opened.
        public static string ProcessPath(int pid)
        {
            IntPtr process = OpenProcess(0x1000 /* PROCESS_QUERY_LIMITED_INFORMATION */, false, pid);
            if (process == IntPtr.Zero) return "";
            try
            {
                StringBuilder sb = new StringBuilder(1024);
                uint size = (uint)sb.Capacity;
                return QueryFullProcessImageName(process, 0, sb, ref size) ? sb.ToString(0, (int)size) : "";
            }
            finally
            {
                CloseHandle(process);
            }
        }

        public static bool Visible(IntPtr hWnd) { return IsWindowVisible(hWnd); }
        public static bool Exists(IntPtr hWnd) { return IsWindow(hWnd); }
        public static IntPtr Foreground() { return GetForegroundWindow(); }
    }
}
