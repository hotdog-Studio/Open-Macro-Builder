using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Macropad
{
    // What the hook decided about one event.
    public class HookResult
    {
        public bool Suppress;
        public int[] Fired = new int[0];
        public bool MaskMenu;
        public int ReinjectVk;
        public int Backspaces;
        public string Text;
    }

    public class InputHookEventArgs : EventArgs
    {
        public InputHookEventArgs(int id) { Id = id; }
        public int Id { get; private set; }
    }

    // Low-level keyboard + mouse hook for AHK-style hotkeys. Every decision is made in C#
    // (ProcessKey / ProcessMouse, which tests drive directly). The real callbacks run on a
    // dedicated thread, return quickly, post fired ids to a window on the UI thread (raised as
    // Fired) and queue any injection for the hook thread to send after the callback returns.
    public sealed class InputHook : IDisposable
    {
        private const int WM_APP_FIRED = 0x8003;  // WM_APP + 3
        private const int WM_APP_INJECT = 0x8004; // WM_APP + 4
        private const int WH_KEYBOARD_LL = 13;
        private const int WH_MOUSE_LL = 14;
        private const uint LLKHF_UP = 0x80;
        private const uint WM_QUIT = 0x0012;

        private const int FlagWildcard = 1;
        private const int FlagPassthrough = 2;
        private const int FlagKeyUp = 4;

        private class Def
        {
            public int Id, Vk, Mods, Flags, PrefixVk, Context;
            public bool Wildcard { get { return (Flags & FlagWildcard) != 0; } }
            public bool Passthrough { get { return (Flags & FlagPassthrough) != 0; } }
            public bool KeyUp { get { return (Flags & FlagKeyUp) != 0; } }
        }

        // Ctrl, Alt, Shift, Win: left and right vk, in the bit order of Def.Mods.
        private static readonly int[,] ModifierPairs = { { 0xA2, 0xA3 }, { 0xA4, 0xA5 }, { 0xA0, 0xA1 }, { 0x5B, 0x5C } };

        private readonly object sync = new object();
        private readonly List<Def> defs = new List<Def>();
        private readonly HashSet<int> activeContexts = new HashSet<int>();
        private readonly bool[] modifierDown = new bool[256];
        private readonly HashSet<int> suppressedDown = new HashSet<int>();
        private readonly Dictionary<int, Def> pendingUp = new Dictionary<int, Def>();
        private int heldPrefix;
        private bool prefixUsed;
        private bool prefixPassthrough;

        private readonly FiredWindow window;
        private readonly Queue<HookResult> injectQueue = new Queue<HookResult>();
        private Thread thread;
        private uint threadId;
        private IntPtr keyboardHook = IntPtr.Zero;
        private IntPtr mouseHook = IntPtr.Zero;
        private readonly HookProc keyboardProc;
        private readonly HookProc mouseProc;

        public event EventHandler<InputHookEventArgs> Fired;
        public object Context { get; set; }

        public InputHook()
        {
            window = new FiredWindow(this);
            keyboardProc = KeyboardCallback;
            mouseProc = MouseCallback;
        }

        // ---- definitions ----

        // flags: 1 Wildcard, 2 Passthrough, 4 KeyUp. context 0 = always active.
        public void AddHotkey(int id, int vk, int mods, int flags, int prefixVk, int context)
        {
            lock (sync)
            {
                Def d = new Def();
                d.Id = id; d.Vk = vk; d.Mods = mods; d.Flags = flags; d.PrefixVk = prefixVk; d.Context = context;
                defs.Add(d);
            }
        }

        public void SetContextActive(int context, bool active)
        {
            lock (sync)
            {
                if (active) activeContexts.Add(context); else activeContexts.Remove(context);
            }
        }

        // ---- decisions ----

        private static int NormalizeModifier(int vk)
        {
            if (vk == 0x10) return 0xA0;
            if (vk == 0x11) return 0xA2;
            if (vk == 0x12) return 0xA4;
            return vk;
        }

        private static bool IsModifier(int vk)
        {
            return (vk >= 0xA0 && vk <= 0xA5) || vk == 0x5B || vk == 0x5C;
        }

        private bool ContextOk(Def d)
        {
            return d.Context == 0 || activeContexts.Contains(d.Context);
        }

        // Do the held modifiers fit the definition? The event's own key is left out of the check.
        private bool ModsFit(Def d, int eventVk)
        {
            for (int i = 0; i < 4; i++)
            {
                int req = (d.Mods >> (2 * i)) & 3;
                int left = ModifierPairs[i, 0], right = ModifierPairs[i, 1];
                bool l = modifierDown[left] && left != eventVk;
                bool r = modifierDown[right] && right != eventVk;
                if (req == 0) { if (!d.Wildcard && (l || r)) return false; }
                else if (req == 1) { if (!l) return false; }
                else if (req == 2) { if (!r) return false; }
                else { if (!l && !r) return false; }
            }
            return true;
        }

        // Context-specific definitions win over global ones, then earlier-added wins.
        private Def BestMatch(Predicate<Def> match)
        {
            foreach (Def d in defs) if (d.Context != 0 && activeContexts.Contains(d.Context) && match(d)) return d;
            foreach (Def d in defs) if (d.Context == 0 && match(d)) return d;
            return null;
        }

        private bool IsPrefix(int vk)
        {
            foreach (Def d in defs) if (d.PrefixVk == vk && ContextOk(d)) return true;
            return false;
        }

        private bool WinOrAltDown()
        {
            return modifierDown[0xA4] || modifierDown[0xA5] || modifierDown[0x5B] || modifierDown[0x5C];
        }

        private static HookResult Fire(HookResult r, int id)
        {
            r.Fired = new int[] { id };
            return r;
        }

        // Decides one key event. self = the event carries Interop.Signature; typed = its text.
        public HookResult ProcessKey(int vk, bool up, bool self, string typed)
        {
            lock (sync)
            {
                HookResult r = new HookResult();
                int nvk = NormalizeModifier(vk);
                if (IsModifier(nvk)) modifierDown[nvk] = !up;
                if (self) return r;
                return up ? KeyUp(nvk, r) : KeyDown(nvk, r);
            }
        }

        // Decides one mouse event: buttons 0x01, 0x02, 0x04, 0x05, 0x06 and wheel pseudo-vks 0x9C-0x9F.
        public HookResult ProcessMouse(int vk, bool up, bool self)
        {
            lock (sync)
            {
                HookResult r = new HookResult();
                if (self) return r;
                if (vk >= 0x9C && vk <= 0x9F)
                {
                    if (up) return r;
                    Def wheel = null;
                    if (heldPrefix != 0)
                    {
                        int prefix = heldPrefix;
                        wheel = BestMatch(delegate (Def d) { return d.PrefixVk == prefix && d.Vk == vk; });
                        if (wheel != null) prefixUsed = true;
                    }
                    if (wheel == null) wheel = BestMatch(delegate (Def d) { return d.PrefixVk == 0 && d.Vk == vk && !d.KeyUp && ModsFit(d, vk); });
                    if (wheel == null) return r;
                    r.Suppress = true;
                    if (WinOrAltDown()) r.MaskMenu = true;
                    return Fire(r, wheel.Id);
                }
                return up ? KeyUp(vk, r) : KeyDown(vk, r);
            }
        }

        private HookResult KeyDown(int vk, HookResult r)
        {
            // Suffix of a custom combination while its prefix is held.
            if (heldPrefix != 0 && heldPrefix != vk)
            {
                int prefix = heldPrefix;
                Def combo = BestMatch(delegate (Def d) { return d.PrefixVk == prefix && d.Vk == vk; });
                if (combo != null)
                {
                    prefixUsed = true;
                    r.Suppress = true;
                    suppressedDown.Add(vk);
                    return Fire(r, combo.Id);
                }
            }

            // Prefix of a custom combination: swallowed (unless ~) until we know whether it is used.
            if (IsPrefix(vk))
            {
                if (heldPrefix != vk)
                {
                    heldPrefix = vk;
                    prefixUsed = false;
                    prefixPassthrough = false;
                    foreach (Def d in defs) if (d.PrefixVk == vk && ContextOk(d) && d.Passthrough) prefixPassthrough = true;
                }
                r.Suppress = !prefixPassthrough;
                return r;
            }

            Def down = BestMatch(delegate (Def d) { return d.PrefixVk == 0 && d.Vk == vk && !d.KeyUp && ModsFit(d, vk); });
            Def upDef = BestMatch(delegate (Def d) { return d.PrefixVk == 0 && d.Vk == vk && d.KeyUp && ModsFit(d, vk); });
            if (down == null && upDef == null) return r;

            bool suppress = false;
            if (down != null)
            {
                Fire(r, down.Id);
                if (!down.Passthrough) suppress = true;
            }
            if (upDef != null)
            {
                pendingUp[vk] = upDef;
                if (!upDef.Passthrough) suppress = true;
            }
            if (suppress)
            {
                r.Suppress = true;
                suppressedDown.Add(vk);
                if (WinOrAltDown()) r.MaskMenu = true;
            }
            return r;
        }

        private HookResult KeyUp(int vk, HookResult r)
        {
            if (heldPrefix != 0 && vk == heldPrefix)
            {
                heldPrefix = 0;
                r.Suppress = !prefixPassthrough;
                if (!prefixUsed)
                {
                    Def own = BestMatch(delegate (Def d) { return d.PrefixVk == 0 && d.Vk == vk && ModsFit(d, vk); });
                    if (own != null) Fire(r, own.Id);
                    else if (!prefixPassthrough) r.ReinjectVk = vk;
                }
                return r;
            }

            Def up;
            if (pendingUp.TryGetValue(vk, out up))
            {
                pendingUp.Remove(vk);
                bool wasSuppressed = suppressedDown.Remove(vk);
                r.Suppress = wasSuppressed;
                return Fire(r, up.Id);
            }

            if (suppressedDown.Remove(vk)) r.Suppress = true;
            return r;
        }

        // ---- delivery to the UI thread ----

        public void PostFired(int id)
        {
            PostMessage(window.Handle, WM_APP_FIRED, new IntPtr(id), IntPtr.Zero);
        }

        private void RaiseFired(int id)
        {
            EventHandler<InputHookEventArgs> handler = Fired;
            if (handler != null) handler(this, new InputHookEventArgs(id));
        }

        private sealed class FiredWindow : NativeWindow
        {
            private readonly InputHook owner;
            public FiredWindow(InputHook owner)
            {
                this.owner = owner;
                CreateHandle(new CreateParams());
            }
            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_APP_FIRED)
                {
                    owner.RaiseFired(m.WParam.ToInt32());
                    return;
                }
                base.WndProc(ref m);
            }
        }

        // ---- the real hooks ----

        private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSLLHOOKSTRUCT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int ptX; public int ptY; }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll")]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern bool PostThreadMessage(uint idThread, uint Msg, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        // Installs both hooks on a new background thread with its own message loop.
        public bool Start()
        {
            bool installed = false;
            using (ManualResetEvent ready = new ManualResetEvent(false))
            {
                thread = new Thread(delegate ()
                {
                    threadId = GetCurrentThreadId();
                    IntPtr module = GetModuleHandle(null);
                    keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyboardProc, module, 0);
                    mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0);
                    installed = keyboardHook != IntPtr.Zero && mouseHook != IntPtr.Zero;
                    if (!installed)
                    {
                        if (keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(keyboardHook);
                        if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
                        keyboardHook = mouseHook = IntPtr.Zero;
                    }
                    ready.Set();
                    if (!installed) return;
                    MSG msg;
                    while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
                    {
                        if (msg.message == WM_APP_INJECT) DrainInjections();
                    }
                    UnhookWindowsHookEx(keyboardHook);
                    UnhookWindowsHookEx(mouseHook);
                    keyboardHook = mouseHook = IntPtr.Zero;
                });
                thread.IsBackground = true;
                thread.Name = "Macropad input hook";
                thread.Start();
                ready.WaitOne();
            }
            return installed;
        }

        // Called with the event's text (Task 21 fills this in); empty for now.
        private string TypedText(int vk, uint scanCode)
        {
            return "";
        }

        private IntPtr KeyboardCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode < 0) return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
            KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            bool up = (k.flags & LLKHF_UP) != 0;
            bool self = k.dwExtraInfo.ToInt64() == Interop.Signature;
            string typed = (up || self) ? "" : TypedText((int)k.vkCode, k.scanCode);
            HookResult r = ProcessKey((int)k.vkCode, up, self, typed);
            Deliver(r);
            return r.Suppress ? new IntPtr(1) : CallNextHookEx(keyboardHook, nCode, wParam, lParam);
        }

        private IntPtr MouseCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            int message = wParam.ToInt32();
            // Mouse moves go straight on before any other work.
            if (nCode < 0 || message == 0x0200) return CallNextHookEx(mouseHook, nCode, wParam, lParam);
            MSLLHOOKSTRUCT m = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            int vk = 0;
            bool up = false;
            switch (message)
            {
                case 0x0201: vk = 0x01; break;
                case 0x0202: vk = 0x01; up = true; break;
                case 0x0204: vk = 0x02; break;
                case 0x0205: vk = 0x02; up = true; break;
                case 0x0207: vk = 0x04; break;
                case 0x0208: vk = 0x04; up = true; break;
                case 0x020B: vk = ((m.mouseData >> 16) & 0xFFFF) == 1 ? 0x05 : 0x06; break;
                case 0x020C: vk = ((m.mouseData >> 16) & 0xFFFF) == 1 ? 0x05 : 0x06; up = true; break;
                case 0x020A: vk = ((short)(m.mouseData >> 16)) > 0 ? 0x9F : 0x9E; break;
                case 0x020E: vk = ((short)(m.mouseData >> 16)) > 0 ? 0x9D : 0x9C; break;
            }
            if (vk == 0) return CallNextHookEx(mouseHook, nCode, wParam, lParam);
            bool self = m.dwExtraInfo.ToInt64() == Interop.Signature;
            HookResult r = ProcessMouse(vk, up, self);
            Deliver(r);
            return r.Suppress ? new IntPtr(1) : CallNextHookEx(mouseHook, nCode, wParam, lParam);
        }

        // Posts fired ids to the UI window; queues injection for the hook thread.
        private void Deliver(HookResult r)
        {
            foreach (int id in r.Fired) PostFired(id);
            if (r.MaskMenu || r.ReinjectVk != 0 || r.Backspaces > 0 || r.Text != null)
            {
                lock (injectQueue) injectQueue.Enqueue(r);
                PostThreadMessage(threadId, WM_APP_INJECT, IntPtr.Zero, IntPtr.Zero);
            }
        }

        private static KeyInput Key(int vk, bool up)
        {
            KeyInput k = new KeyInput();
            k.Vk = vk;
            k.Up = up;
            return k;
        }

        private void DrainInjections()
        {
            while (true)
            {
                HookResult r;
                lock (injectQueue)
                {
                    if (injectQueue.Count == 0) return;
                    r = injectQueue.Dequeue();
                }
                List<KeyInput> keys = new List<KeyInput>();
                if (r.MaskMenu) { keys.Add(Key(0xE8, false)); keys.Add(Key(0xE8, true)); }
                if (r.ReinjectVk != 0)
                {
                    if (r.ReinjectVk >= 0x01 && r.ReinjectVk <= 0x06 && r.ReinjectVk != 0x03) InjectMouseButton(r.ReinjectVk);
                    else { keys.Add(Key(r.ReinjectVk, false)); keys.Add(Key(r.ReinjectVk, true)); }
                }
                for (int i = 0; i < r.Backspaces; i++) { keys.Add(Key(0x08, false)); keys.Add(Key(0x08, true)); }
                if (r.Text != null)
                {
                    foreach (char c in r.Text)
                    {
                        if (c == '\r') continue;
                        if (c == '\n') { keys.Add(Key(0x0D, false)); keys.Add(Key(0x0D, true)); continue; }
                        if (c == '\t') { keys.Add(Key(0x09, false)); keys.Add(Key(0x09, true)); continue; }
                        KeyInput down = new KeyInput(); down.Char = c;
                        KeyInput upKey = new KeyInput(); upKey.Char = c; upKey.Up = true;
                        keys.Add(down); keys.Add(upKey);
                    }
                }
                if (keys.Count > 0) Inject.Send(keys.ToArray());
            }
        }

        private static void InjectMouseButton(int vk)
        {
            uint downFlag, upFlag, data = 0;
            switch (vk)
            {
                case 0x01: downFlag = 0x2; upFlag = 0x4; break;
                case 0x02: downFlag = 0x8; upFlag = 0x10; break;
                case 0x04: downFlag = 0x20; upFlag = 0x40; break;
                case 0x05: downFlag = 0x80; upFlag = 0x100; data = 1; break;
                default: downFlag = 0x80; upFlag = 0x100; data = 2; break;
            }
            Inject.Mouse(downFlag, data);
            Inject.Mouse(upFlag, data);
        }

        public void Dispose()
        {
            if (thread != null && thread.IsAlive)
            {
                PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                thread.Join(1000);
            }
            thread = null;
            if (window.Handle != IntPtr.Zero) window.DestroyHandle();
        }
    }
}
