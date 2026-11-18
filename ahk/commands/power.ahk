#Requires AutoHotkey v2.0

; *********************** Power & Sleep *********************
/**
 * Turns the monitors off, a second after the key is pressed. Shows an error when there is no desktop window (Explorer is not running).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
TurnMonitorsOff(Macro)
{
   Sleep 1000
   if !WinExist("Program Manager")  ; the desktop window
      throw Error("No desktop window to turn the monitors off with. Is Explorer running?")
   SendMessage(0x112,0xF170,2,,"Program Manager")  ; gives up after 5 seconds when the desktop does not answer
}

/**
 * Send the Lock command
 * @param {Macro} Macro - The macro object (not used in this function).
 */
Lock(Macro)
{
   DllCall("LockWorkStation")
}

/**
 * Puts the computer to sleep. Shows an error when Windows refuses.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
WinSleep(Macro)
{
    if !DllCall("PowrProf\SetSuspendState", "Int", 0, "Int", 0, "Int", 0, "UChar")  ; it returns a one-byte BOOLEAN
        throw Error("Windows did not go to sleep.")
}

/**
 * Hibernates the computer. Shows an error when Windows refuses, as it does when hibernation is turned off.
 * @param {Macro} Macro - The macro object (not used in this function).
 */
Hibernate(Macro)
{
    if !DllCall("PowrProf\SetSuspendState", "Int", 1, "Int", 0, "Int", 0, "UChar")  ; it returns a one-byte BOOLEAN
        throw Error("Windows did not hibernate. Is hibernation turned on (powercfg /hibernate on)?")
}

/**
 * Restarts the computer (shutdown /r /t 1).
 * @param {Macro} Macro - The macro object (not used in this function).
 */
Restart(Macro)
{
   ; shutdown.exe: ExitWindowsEx needs the shutdown privilege, which this script does not enable. Not the
   ; built-in Shutdown either: the Shutdown command below hides it, and would turn the PC off.
   Run("shutdown /r /t 1")
}

/**
 * Send the Shutdown command
 * @param {Macro} Macro - The macro object (not used in this function).
 */
Shutdown(Macro)
{
   Run("shutdown /s /t 1")
}