namespace Macropad
{
    public static class Interop
    {
        // dwExtraInfo on every key and mouse event the macropad injects ("MPAD").
        // Hooks ignore events carrying it. Native.ps1 keeps the same value as MacropadSignature.
        public const int Signature = 0x4D504144;
    }
}
