/** Codes whose AutoHotkey name differs from the code, or is the code itself but is not a pattern below. */
const NAMED: Record<string, string> = {
  NumpadAdd: 'NumpadAdd',
  NumpadSubtract: 'NumpadSub',
  NumpadMultiply: 'NumpadMult',
  NumpadDivide: 'NumpadDiv',
  NumpadDecimal: 'NumpadDot',
  NumpadEnter: 'NumpadEnter',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  PrintScreen: 'PrintScreen',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Tab: 'Tab',
  Enter: 'Enter',
  Space: 'Space',
  Backspace: 'Backspace',
  CapsLock: 'CapsLock',
  ControlLeft: 'LCtrl',
  ControlRight: 'RCtrl',
  ShiftLeft: 'LShift',
  ShiftRight: 'RShift',
  AltLeft: 'LAlt',
  AltRight: 'RAlt',
  MetaLeft: 'LWin',
  MetaRight: 'RWin',
  MediaPlayPause: 'Media_Play_Pause',
  MediaTrackNext: 'Media_Next',
  MediaTrackPrevious: 'Media_Prev',
  MediaStop: 'Media_Stop',
  AudioVolumeUp: 'Volume_Up',
  AudioVolumeDown: 'Volume_Down',
  AudioVolumeMute: 'Volume_Mute',
}

/** KeyboardEvent.code → the name AutoHotkey (and the config) uses, or null when there is none. */
export function ahkKeyName(code: string): string | null {
  if (Object.hasOwn(NAMED, code)) return NAMED[code]
  const fn = /^F(\d{1,2})$/.exec(code)
  if (fn && Number(fn[1]) >= 1 && Number(fn[1]) <= 24 && !fn[1].startsWith('0')) return code
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1].toLowerCase()
  const digit = /^Digit(\d)$/.exec(code)
  if (digit) return digit[1]
  if (/^Numpad\d$/.test(code)) return code
  return null
}
