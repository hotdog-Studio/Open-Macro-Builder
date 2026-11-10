using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Macropad
{
    // One key or character event to inject. Char != 0 means a Unicode character event.
    public class KeyInput
    {
        public int Vk;
        public int Char;
        public bool Up;
        public bool Extended;
    }

    // SendInput wrapper. Every event is tagged with Interop.Signature.
    public static class Inject
    {
        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_EXTENDEDKEY = 0x1;
        private const uint KEYEVENTF_KEYUP = 0x2;
        private const uint KEYEVENTF_UNICODE = 0x4;

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        // MOUSEINPUT is the widest member, so INPUT is 40 bytes in a 64-bit process and 28 in a 32-bit one.
        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
        [DllImport("user32.dll")]
        private static extern uint MapVirtualKey(uint uCode, uint uMapType);

        public static int InputSize
        {
            get { return Marshal.SizeOf(typeof(INPUT)); }
        }

        private static INPUT KeyEvent(ushort vk, ushort scan, uint flags)
        {
            INPUT input = new INPUT();
            input.type = INPUT_KEYBOARD;
            input.u.ki.wVk = vk;
            input.u.ki.wScan = scan;
            input.u.ki.dwFlags = flags;
            input.u.ki.dwExtraInfo = new IntPtr(Interop.Signature);
            return input;
        }

        // Sends all events in one SendInput call; returns the number of events inserted.
        public static int Send(KeyInput[] inputs)
        {
            if (inputs == null || inputs.Length == 0) return 0;
            List<INPUT> list = new List<INPUT>();
            foreach (KeyInput k in inputs)
            {
                uint up = k.Up ? KEYEVENTF_KEYUP : 0;
                if (k.Char != 0)
                {
                    // Characters beyond the BMP go as a surrogate pair.
                    string text = char.ConvertFromUtf32(k.Char);
                    foreach (char c in text) list.Add(KeyEvent(0, c, KEYEVENTF_UNICODE | up));
                }
                else
                {
                    ushort scan = (ushort)MapVirtualKey((uint)k.Vk, 0);
                    uint flags = up | (k.Extended ? KEYEVENTF_EXTENDEDKEY : 0);
                    list.Add(KeyEvent((ushort)k.Vk, scan, flags));
                }
            }
            INPUT[] array = list.ToArray();
            return (int)SendInput((uint)array.Length, array, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void Key(int vk, bool up, bool extended)
        {
            KeyInput k = new KeyInput();
            k.Vk = vk;
            k.Up = up;
            k.Extended = extended;
            Send(new KeyInput[] { k });
        }

        // One tagged mouse event at the current cursor position.
        public static void Mouse(uint flags, uint data)
        {
            INPUT input = new INPUT();
            input.type = INPUT_MOUSE;
            input.u.mi.dwFlags = flags;
            input.u.mi.mouseData = data;
            input.u.mi.dwExtraInfo = new IntPtr(Interop.Signature);
            SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
        }
    }
}
