import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { app, BrowserWindow, nativeTheme, session, shell } from 'electron'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { recentProjects } from './store'

// Lets tests (and power users) keep a separate profile.
if (process.env['YAZ_USER_DATA']) app.setPath('userData', resolve(process.env['YAZ_USER_DATA']))

const isDev = !app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL'])

/** A folder passed on the command line (`yaz-paste C:\code\shop`) wins; otherwise reopen the last project. */
async function startupPath(): Promise<string | null> {
  const appPath = resolve(app.getAppPath())
  const args = process.argv.slice(1).filter((a) => !a.startsWith('-'))
  // the last folder argument wins; in dev the app's own folder is also an argument, so skip it
  for (const arg of args.reverse()) {
    if (resolve(arg) === appPath) continue
    try {
      if ((await fs.stat(arg)).isDirectory()) return arg
    } catch {
      // not a folder
    }
  }
  if (process.env['YAZ_NO_RESTORE']) return null
  return (await recentProjects())[0] ?? null
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'yaz-paste',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#f6f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win.show())

  if (isDev && process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

/** Security baseline: no navigation away from the app, no new windows, no webviews, no permissions. */
function lockDown(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const devUrl = process.env['ELECTRON_RENDERER_URL']
      if (devUrl && url.startsWith(devUrl)) return
      event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      // open real web links in the user's browser, never inside the app
      if (/^https:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    // copying from the file viewer is the only thing the page may do
    callback(permission === 'clipboard-sanitized-write')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  void app.whenReady().then(() => {
    lockDown()
    buildMenu(isDev)
    registerIpc(startupPath)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
