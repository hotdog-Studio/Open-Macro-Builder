using System;
using System.Runtime.InteropServices;

namespace Macropad
{
    // Master volume and mute of the default playback device through Core Audio.
    // Every call opens the endpoint and releases every COM object it used.
    public static class Audio
    {
        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        private class MMDeviceEnumeratorComObject { }

        // Methods are declared in header order up to the last one used: vtable slots are positional.
        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        }

        [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioEndpointVolume
        {
            [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
            [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
            [PreserveSig] int GetChannelCount(out uint pnChannelCount);
            [PreserveSig] int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
            [PreserveSig] int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
            [PreserveSig] int GetMasterVolumeLevel(out float pfLevelDB);
            [PreserveSig] int GetMasterVolumeLevelScalar(out float pfLevel);
            [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
            [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
            [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
            [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
            [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
            [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
        }

        private const int eRender = 0;
        private const int eMultimedia = 1;
        private const int CLSCTX_ALL = 23;
        private const int E_NOTFOUND = unchecked((int)0x80070490);

        private static void Check(int hr)
        {
            if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        }

        private static T WithEndpoint<T>(Func<IAudioEndpointVolume, T> action)
        {
            IMMDeviceEnumerator enumerator = null;
            IMMDevice device = null;
            object activated = null;
            try
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                int hr = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia, out device);
                if (hr == E_NOTFOUND) throw new InvalidOperationException("No default playback device");
                Check(hr);
                Guid iid = typeof(IAudioEndpointVolume).GUID;
                Check(device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out activated));
                return action((IAudioEndpointVolume)activated);
            }
            finally
            {
                if (activated != null) Marshal.ReleaseComObject(activated);
                if (device != null) Marshal.ReleaseComObject(device);
                if (enumerator != null) Marshal.ReleaseComObject(enumerator);
            }
        }

        // 0 to 1.
        public static float GetVolume()
        {
            return WithEndpoint<float>(delegate (IAudioEndpointVolume v)
            {
                float level;
                Check(v.GetMasterVolumeLevelScalar(out level));
                return level;
            });
        }

        public static void SetVolume(float level)
        {
            float clamped = Math.Max(0f, Math.Min(1f, level));
            WithEndpoint<bool>(delegate (IAudioEndpointVolume v)
            {
                Guid context = Guid.Empty;
                Check(v.SetMasterVolumeLevelScalar(clamped, ref context));
                return true;
            });
        }

        public static bool GetMute()
        {
            return WithEndpoint<bool>(delegate (IAudioEndpointVolume v)
            {
                bool mute;
                Check(v.GetMute(out mute));
                return mute;
            });
        }

        public static void SetMute(bool mute)
        {
            WithEndpoint<bool>(delegate (IAudioEndpointVolume v)
            {
                Guid context = Guid.Empty;
                Check(v.SetMute(mute, ref context));
                return true;
            });
        }
    }
}
