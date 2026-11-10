/** IPC channel names shared by the preload and the main process. */
export const CHANNELS = {
  openFolder: 'omb:open-folder',
  restoreFolder: 'omb:restore-folder',
  readBytes: 'omb:read-bytes',
  writeBytes: 'omb:write-bytes',
  list: 'omb:list',
  remove: 'omb:remove',
  watch: 'omb:watch',
  findMacropad: 'omb:find-macropad',
  reloadMacropad: 'omb:reload-macropad',
  installedLanguages: 'omb:installed-languages',
  /** Main to page: a watched file changed. */
  changed: 'omb:changed',
} as const
