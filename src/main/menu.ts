import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

function send(command: MenuCommand): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu', command)
}

export function buildMenu(isDev: boolean): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder…', accelerator: 'CommandOrControl+O', click: () => send('open-folder') },
        { label: 'Rescan Folder', accelerator: 'F5', click: () => send('rescan') },
        { type: 'separator' },
        { label: 'Copy Prompt', accelerator: 'CommandOrControl+Shift+C', click: () => send('copy') },
        { label: 'Preview Prompt', accelerator: 'CommandOrControl+Shift+P', click: () => send('preview') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // the Edit menu is what makes Cmd+C / Cmd+V work in text fields on macOS
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(isDev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  app.setAboutPanelOptions?.({ applicationName: 'yaz-paste', applicationVersion: app.getVersion() })
}
