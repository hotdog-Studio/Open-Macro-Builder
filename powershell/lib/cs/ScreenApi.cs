using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace Macropad
{
    // Screen capture, pixel and image search, cursor and window-at-point (Screen.ps1).
    public static class ScreenApi
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X, Y; }

        [DllImport("user32.dll")]
        private static extern bool GetCursorPos(out POINT lpPoint);
        [DllImport("user32.dll")]
        private static extern IntPtr WindowFromPoint(POINT point);
        [DllImport("user32.dll")]
        private static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
        [DllImport("user32.dll")]
        private static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

        // ARGB pixels of the whole bitmap, row by row.
        private static int[] Pixels(Bitmap bmp)
        {
            Rectangle rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
            BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                int[] pixels = new int[bmp.Width * bmp.Height];
                if (data.Stride == bmp.Width * 4)
                {
                    Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
                }
                else
                {
                    for (int y = 0; y < bmp.Height; y++)
                    {
                        Marshal.Copy(new IntPtr(data.Scan0.ToInt64() + (long)y * data.Stride), pixels, y * bmp.Width, bmp.Width);
                    }
                }
                return pixels;
            }
            finally
            {
                bmp.UnlockBits(data);
            }
        }

        private static bool Near(int argb, int rgb, int variation)
        {
            return Math.Abs(((argb >> 16) & 0xFF) - ((rgb >> 16) & 0xFF)) <= variation
                && Math.Abs(((argb >> 8) & 0xFF) - ((rgb >> 8) & 0xFF)) <= variation
                && Math.Abs((argb & 0xFF) - (rgb & 0xFF)) <= variation;
        }

        // [x, y] of the first pixel within variation of rgb (0xRRGGBB), rows top to bottom; null when none.
        public static int[] FindPixel(Bitmap bmp, int rgb, int variation)
        {
            int[] pixels = Pixels(bmp);
            for (int y = 0; y < bmp.Height; y++)
            {
                for (int x = 0; x < bmp.Width; x++)
                {
                    if (Near(pixels[y * bmp.Width + x], rgb, variation)) return new int[] { x, y };
                }
            }
            return null;
        }

        // Top-left [x, y] of the first place the needle matches; needle pixels equal to transRgb
        // match anything (-1 = none). null when none.
        public static int[] FindImage(Bitmap haystack, Bitmap needle, int variation, int transRgb)
        {
            int hw = haystack.Width, hh = haystack.Height, nw = needle.Width, nh = needle.Height;
            if (nw > hw || nh > hh) return null;
            int[] hay = Pixels(haystack);
            int[] pin = Pixels(needle);
            for (int y = 0; y <= hh - nh; y++)
            {
                for (int x = 0; x <= hw - nw; x++)
                {
                    bool match = true;
                    for (int ny = 0; ny < nh && match; ny++)
                    {
                        for (int nx = 0; nx < nw; nx++)
                        {
                            int n = pin[ny * nw + nx];
                            if (transRgb >= 0 && (n & 0xFFFFFF) == (transRgb & 0xFFFFFF)) continue;
                            if (!Near(hay[(y + ny) * hw + x + nx], n & 0xFFFFFF, variation)) { match = false; break; }
                        }
                    }
                    if (match) return new int[] { x, y };
                }
            }
            return null;
        }

        public static Bitmap Capture(int x, int y, int w, int h)
        {
            Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(x, y, 0, 0, new Size(w, h));
            }
            return bmp;
        }

        public static int[] CursorPos()
        {
            POINT p;
            GetCursorPos(out p);
            return new int[] { p.X, p.Y };
        }

        public static IntPtr WindowAt(int x, int y)
        {
            POINT p = new POINT();
            p.X = x; p.Y = y;
            return WindowFromPoint(p);
        }

        public static IntPtr Root(IntPtr hWnd)
        {
            return GetAncestor(hWnd, 2 /* GA_ROOT */);
        }

        public static int[] ClientToScreen(IntPtr hWnd, int x, int y)
        {
            POINT p = new POINT();
            p.X = x; p.Y = y;
            ClientToScreen(hWnd, ref p);
            return new int[] { p.X, p.Y };
        }
    }
}
