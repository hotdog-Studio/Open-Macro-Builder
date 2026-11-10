import { createBrowserPlatform, idbHandleStore } from './browser'
import type { Platform } from './types'

export const UNSUPPORTED = 'Open Macro Builder needs Chrome or Edge to open a folder on your PC.'

type PickerWindow = Window & {
  omb?: unknown
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}

export function detectPlatform(w: PickerWindow): Platform | { unsupported: string } {
  // Seam for Task 16: when the Electron preload exposes `w.omb`, return the
  // Electron platform here, before the browser check.
  const picker = w.showDirectoryPicker?.bind(w)
  if (picker) {
    return createBrowserPlatform({
      pick: () => picker({ mode: 'readwrite' }),
      store: idbHandleStore,
    })
  }
  return { unsupported: UNSUPPORTED }
}
