import { BrowserWindow, clipboard, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ComposeRequest, ComposeResult, ProjectInfo, ProjectState } from '../shared/types'
import { Project } from './project'
import { addRecentProject, recentProjects, saveProjectState } from './store'

let current: Project | null = null

/** Only our own renderer may call the API (not some other frame or a page navigated to by accident). */
function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const trusted = url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl))
  if (!trusted || event.senderFrame?.parent) throw new Error('Untrusted sender')
}

function requireProject(): Project {
  if (!current) throw new Error('No project is open')
  return current
}

export async function openProject(path: string): Promise<ProjectInfo> {
  const { project, info } = await Project.open(path)
  current = project
  await addRecentProject(project.root)
  return info
}

function stripInternal(result: ComposeResult & { fileBlocks?: unknown }): ComposeResult {
  const { fileBlocks: _blocks, ...rest } = result
  return rest
}

export function registerIpc(startupPath: () => Promise<string | null>): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event)
      return fn(...(args as A))
    })
  }

  handle('project:startup', async () => {
    const path = await startupPath()
    if (!path) return null
    try {
      return await openProject(path)
    } catch {
      return null
    }
  })

  handle('project:open-folder', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, { title: 'Open project folder', properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return openProject(result.filePaths[0])
  })

  handle('project:open', async (root: string) => {
    if (typeof root !== 'string') throw new Error('Invalid path')
    // only folders from the recent list can be reopened without the folder dialog
    if (!(await recentProjects()).includes(root)) throw new Error('Unknown project')
    return openProject(root)
  })

  handle('project:rescan', async () => {
    if (!current) return null
    const info = await current.scan()
    return { ...info, state: null }
  })

  handle('project:recent', () => recentProjects())
  handle('file:read', (path: string) => requireProject().readFile(path))
  handle('skills:list', () => requireProject().listSkills())
  handle('prompt:estimate', (req: ComposeRequest) => requireProject().estimate(req))
  handle('prompt:compose', async (req: ComposeRequest) => stripInternal(await requireProject().compose(req)))
  handle('prompt:copy', async (req: ComposeRequest) => {
    const result = await requireProject().compose(req)
    clipboard.writeText(result.text)
    return stripInternal(result)
  })
  handle('state:save', async (state: ProjectState) => {
    if (current && state && typeof state === 'object') await saveProjectState(current.root, state)
  })
}
