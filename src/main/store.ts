import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ProjectState } from '../shared/types'

/**
 * Per-project state lives in the OS app-data folder (`%APPDATA%\yaz-paste` / `~/Library/Application Support/yaz-paste`),
 * never inside the project, so nothing leaks into git. None of it is secret, so it's plain JSON.
 */

const MAX_RECENT = 10

function dataDir(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

function projectFile(root: string): string {
  return dataDir('projects', createHash('sha256').update(root).digest('hex').slice(0, 24) + '.json')
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(join(file, '..'), { recursive: true })
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export async function loadProjectState(root: string): Promise<ProjectState | null> {
  const saved = await readJson<{ root: string; state: ProjectState }>(projectFile(root))
  return saved && saved.root === root ? saved.state : null
}

export async function saveProjectState(root: string, state: ProjectState): Promise<void> {
  await writeJson(projectFile(root), { root, state })
}

export async function recentProjects(): Promise<string[]> {
  const list = (await readJson<string[]>(dataDir('recent.json'))) ?? []
  const existing: string[] = []
  for (const root of list) {
    try {
      if ((await fs.stat(root)).isDirectory()) existing.push(root)
    } catch {
      // folder gone
    }
  }
  return existing
}

export async function addRecentProject(root: string): Promise<void> {
  const list = ((await readJson<string[]>(dataDir('recent.json'))) ?? []).filter((r) => r !== root)
  await writeJson(dataDir('recent.json'), [root, ...list].slice(0, MAX_RECENT))
}
