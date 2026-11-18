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
