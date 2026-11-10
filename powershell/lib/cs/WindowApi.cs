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

        // ---- actions, styles, messages and controls (WindowOps.ps1) ----

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X, Y; }

        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOZORDER = 0x0004;
        private const uint SWP_NOACTIVATE = 0x0010;
        private const uint SWP_FRAMECHANGED = 0x0020;
        private const int GWL_STYLE = -16;
        private const int GWL_EXSTYLE = -20;
        private const long WS_EX_LAYERED = 0x80000;
        private const uint LWA_COLORKEY = 0x1;
        private const uint LWA_ALPHA = 0x2;
        private const uint SMTO_ABORTIFHUNG = 0x2;
        private const uint WM_SETTEXT = 0x000C;
        private const uint WM_GETTEXT = 0x000D;
        private const uint WM_GETTEXTLENGTH = 0x000E;

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
        [DllImport("user32.dll")]
        private static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
        [DllImport("user32.dll")]
        private static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern bool IsZoomed(IntPtr hWnd);
        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
        private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
        private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
        private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int dwNewLong);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
        [DllImport("user32.dll")]
        private static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, StringBuilder lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);
        [DllImport("user32.dll")]
        private static extern bool EnumChildWindows(IntPtr hWndParent, EnumProc lpEnumFunc, IntPtr lParam);

        // x, y, width, height of the whole window in screen coordinates.
        public static int[] Rect(IntPtr hWnd)
        {
            RECT r;
            GetWindowRect(hWnd, out r);
            return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
        }

        // Screen x, y of the client area's origin, and the client width and height.
        public static int[] ClientRect(IntPtr hWnd)
        {
            RECT r;
            GetClientRect(hWnd, out r);
            POINT p = new POINT();
            ClientToScreen(hWnd, ref p);
            return new int[] { p.X, p.Y, r.Right - r.Left, r.Bottom - r.Top };
        }

        public static bool Move(IntPtr hWnd, int x, int y, int w, int h)
        {
            return SetWindowPos(hWnd, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
        }

        public static bool SetTopmost(IntPtr hWnd, bool on)
        {
            IntPtr after = new IntPtr(on ? -1 /* HWND_TOPMOST */ : -2 /* HWND_NOTOPMOST */);
            return SetWindowPos(hWnd, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        public static bool IsMinimized(IntPtr hWnd) { return IsIconic(hWnd); }
        public static bool IsMaximized(IntPtr hWnd) { return IsZoomed(hWnd); }
        public static bool ShowCmd(IntPtr hWnd, int cmd) { return ShowWindow(hWnd, cmd); }

        public static long GetStyle(IntPtr hWnd, bool ex)
        {
            int index = ex ? GWL_EXSTYLE : GWL_STYLE;
            if (IntPtr.Size == 4) return (long)(uint)GetWindowLong32(hWnd, index);
            return GetWindowLongPtr64(hWnd, index).ToInt64();
        }

        public static long SetStyle(IntPtr hWnd, bool ex, long value)
        {
            int index = ex ? GWL_EXSTYLE : GWL_STYLE;
            if (IntPtr.Size == 4) return (long)(uint)SetWindowLong32(hWnd, index, unchecked((int)value));
            return SetWindowLongPtr64(hWnd, index, new IntPtr(value)).ToInt64();
        }

        public static void RefreshFrame(IntPtr hWnd)
        {
            SetWindowPos(hWnd, IntPtr.Zero, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
        }

        // alpha 0-255 and/or colorRef (0x00BBGGRR) when >= 0; both -1 removes WS_EX_LAYERED.
        public static bool SetLayered(IntPtr hWnd, int alpha, int colorRef)
        {
            long ex = GetStyle(hWnd, true);
            if (alpha < 0 && colorRef < 0)
            {
                SetStyle(hWnd, true, ex & ~WS_EX_LAYERED);
                return true;
            }
            SetStyle(hWnd, true, ex | WS_EX_LAYERED);
            uint flags = 0;
            if (alpha >= 0) flags |= LWA_ALPHA;
            if (colorRef >= 0) flags |= LWA_COLORKEY;
            return SetLayeredWindowAttributes(hWnd, colorRef >= 0 ? (uint)colorRef : 0, (byte)(alpha >= 0 ? Math.Min(alpha, 255) : 255), flags);
        }

        public static bool Post(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam)
        {
            return PostMessage(hWnd, msg, wParam, lParam);
        }

        // SendMessageTimeout with SMTO_ABORTIFHUNG; throws when the window does not answer in time.
        public static long Send(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, int timeoutMs)
        {
            IntPtr result;
            if (SendMessageTimeout(hWnd, msg, wParam, lParam, SMTO_ABORTIFHUNG, (uint)timeoutMs, out result) == IntPtr.Zero)
            {
                throw new TimeoutException("SendMessage timed out or failed.");
            }
            return result.ToInt64();
        }

        // Every descendant window in EnumChildWindows order (the order ClassNN counts in).
        public static IntPtr[] Children(IntPtr hWnd)
        {
            List<IntPtr> found = new List<IntPtr>();
            EnumProc callback = delegate (IntPtr child, IntPtr lParam) { found.Add(child); return true; };
            EnumChildWindows(hWnd, callback, IntPtr.Zero);
            GC.KeepAlive(callback);
            return found.ToArray();
        }

        public static string GetText(IntPtr hWnd, int timeoutMs)
        {
            IntPtr length;
            if (SendMessageTimeout(hWnd, WM_GETTEXTLENGTH, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, (uint)timeoutMs, out length) == IntPtr.Zero)
            {
                throw new TimeoutException("WM_GETTEXTLENGTH timed out or failed.");
            }
            StringBuilder sb = new StringBuilder(length.ToInt32() + 1);
            IntPtr copied;
            if (SendMessageTimeout(hWnd, WM_GETTEXT, new IntPtr(sb.Capacity), sb, SMTO_ABORTIFHUNG, (uint)timeoutMs, out copied) == IntPtr.Zero)
            {
                throw new TimeoutException("WM_GETTEXT timed out or failed.");
            }
            return sb.ToString();
        }

        public static bool SetText(IntPtr hWnd, string text)
        {
            return SendMessage(hWnd, WM_SETTEXT, IntPtr.Zero, text) != IntPtr.Zero;
        }
    }
}
