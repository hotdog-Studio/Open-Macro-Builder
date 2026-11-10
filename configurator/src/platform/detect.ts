import { createBrowserPlatform, idbHandleStore } from './browser'
import { createElectronPlatform, type OmbBridge } from './electron'
import type { Platform } from './types'

export const UNSUPPORTED = 'Open Macro Builder needs Chrome or Edge to open a folder on your PC.'

type PickerWindow = Window & {
  omb?: OmbBridge
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}

export function detectPlatform(w: PickerWindow): Platform | { unsupported: string } {
  // Electron's page also has showDirectoryPicker, so its preload bridge wins.
  if (w.omb) return createElectronPlatform(w.omb)
  const picker = w.showDirectoryPicker?.bind(w)
  if (picker) {
    return createBrowserPlatform({
      pick: () => picker({ mode: 'readwrite' }),
      store: idbHandleStore,
    })
  }
  return { unsupported: UNSUPPORTED }
}
