import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { OmbBridge } from '../src/platform/electron'
import { CHANNELS } from './channels'

// Only these functions reach the page; it gets no ipcRenderer and no Node.
const bridge: OmbBridge = {
  openFolder: () => ipcRenderer.invoke(CHANNELS.openFolder),
  restoreFolder: () => ipcRenderer.invoke(CHANNELS.restoreFolder),
  readBytes: (rel) => ipcRenderer.invoke(CHANNELS.readBytes, rel),
  writeBytes: (rel, data) => ipcRenderer.invoke(CHANNELS.writeBytes, rel, data),
  list: (rel) => ipcRenderer.invoke(CHANNELS.list, rel),
  remove: (rel) => ipcRenderer.invoke(CHANNELS.remove, rel),
  watch: (rels) => ipcRenderer.invoke(CHANNELS.watch, rels),
  onChanged: (cb) => {
    const listener = (_event: IpcRendererEvent, rel: string) => cb(rel)
    ipcRenderer.on(CHANNELS.changed, listener)
    return () => {
      ipcRenderer.removeListener(CHANNELS.changed, listener)
    }
  },
  findMacropad: () => ipcRenderer.invoke(CHANNELS.findMacropad),
  reloadMacropad: () => ipcRenderer.invoke(CHANNELS.reloadMacropad),
  installedLanguages: () => ipcRenderer.invoke(CHANNELS.installedLanguages),
}

contextBridge.exposeInMainWorld('omb', bridge)
