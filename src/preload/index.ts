import { contextBridge, ipcRenderer } from 'electron'
import type { MenuCommand, YazApi } from '../shared/types'

/**
 * The only bridge between the UI and the system. The UI never touches the file system or Node; it can only
 * call these functions, and the main process validates every argument.
 */
const api: YazApi = {
  startupProject: () => ipcRenderer.invoke('project:startup'),
  openFolder: () => ipcRenderer.invoke('project:open-folder'),
  openProject: (root) => ipcRenderer.invoke('project:open', root),
  rescan: () => ipcRenderer.invoke('project:rescan'),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  listContext: () => ipcRenderer.invoke('context:list'),
  listPresets: () => ipcRenderer.invoke('presets:list'),
  addContextFiles: (scope) => ipcRenderer.invoke('context:add', scope),
  savePreset: (input) => ipcRenderer.invoke('presets:save', input),
  getLibraryItem: (kind, id) => ipcRenderer.invoke('library:get', kind, id),
  saveLibraryItem: (input) => ipcRenderer.invoke('library:save', input),
  deleteLibraryItem: (kind, id) => ipcRenderer.invoke('library:delete', kind, id),
  deletePreset: (id) => ipcRenderer.invoke('presets:delete', id),
  openLibraryFolder: (scope, kind) => ipcRenderer.invoke('library:open-folder', scope, kind),
  estimate: (req) => ipcRenderer.invoke('prompt:estimate', req),
  compose: (req) => ipcRenderer.invoke('prompt:compose', req),
  copy: (req) => ipcRenderer.invoke('prompt:copy', req),
  saveState: (state) => ipcRenderer.invoke('state:save', state),
  onMenu: (handler) => {
    const listener = (_event: unknown, command: MenuCommand): void => handler(command)
    ipcRenderer.on('menu', listener)
    return () => ipcRenderer.removeListener('menu', listener)
  },
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
