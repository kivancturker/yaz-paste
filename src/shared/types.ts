/** Types shared by the main process, preload and UI. Keep this file free of runtime imports. */

export type ProjectType = 'dotnet' | 'node'

export type FileStatus = 'ok' | 'blocked' | 'too-large'

export interface FileEntry {
  /** Project-relative path, always with `/` separators. */
  path: string
  size: number
  status: FileStatus
  /** Why the file can't be included (blocked / too large). */
  reason?: string
  /** Config files that often hold secrets: included only after a scan, shown with a shield. */
  sensitive?: boolean
}

/** Inclusive, 1-based line range. */
export type LineRange = [number, number]

export type FileSelection =
  | { mode: 'whole' }
  | { mode: 'ranges'; ranges: LineRange[]; hash: string }

export type OutputFormat = 'xml' | 'markdown'
export type TreeMode = 'selected' | 'full' | 'none'

export interface ProjectState {
  selection: Record<string, FileSelection>
  task: string
  skillId: string | null
  format: OutputFormat
  treeMode: TreeMode
  wholeFileLineNumbers: boolean
}

export interface ProjectInfo {
  root: string
  name: string
  types: ProjectType[]
  files: FileEntry[]
  scanMode: 'git' | 'walk'
  /** True when the scan stopped at the file limit. */
  truncated: boolean
  state: ProjectState | null
}

export interface FileContent {
  path: string
  content: string
  hash: string
  binary: boolean
  lineCount: number
}

export type SkillSource = 'project' | 'user' | 'built-in'

export interface SkillInfo {
  /** Unique id: the skill name. */
  id: string
  name: string
  description: string
  source: SkillSource
  /** Folder that holds SKILL.md. */
  dir: string
  extraFiles: string[]
}

export interface ComposeRequest {
  selection: Record<string, FileSelection>
  task: string
  skillId: string | null
  format: OutputFormat
  treeMode: TreeMode
  wholeFileLineNumbers: boolean
  /** Finding ids the user allowed for this one copy. */
  allow?: string[]
}

export interface SecretFindingInfo {
  id: string
  path: string
  line: number
  rule: string
  /** The line with the secret already masked, for context in the review panel. */
  preview: string
}

export interface ComposeWarning {
  path: string
  message: string
}

export interface ComposeResult {
  text: string
  tokens: number
  fileCount: number
  findings: SecretFindingInfo[]
  allowedCount: number
  warnings: ComposeWarning[]
}

export interface TokenEstimate {
  total: number
  perFile: Record<string, number>
}

export interface YazApi {
  /** Folder from the command line, or the last opened project. */
  startupProject(): Promise<ProjectInfo | null>
  openFolder(): Promise<ProjectInfo | null>
  openProject(root: string): Promise<ProjectInfo>
  rescan(): Promise<ProjectInfo | null>
  recentProjects(): Promise<string[]>
  readFile(path: string): Promise<FileContent>
  listSkills(): Promise<SkillInfo[]>
  estimate(req: ComposeRequest): Promise<TokenEstimate>
  compose(req: ComposeRequest): Promise<ComposeResult>
  copy(req: ComposeRequest): Promise<ComposeResult>
  saveState(state: ProjectState): Promise<void>
  onMenu(handler: (command: MenuCommand) => void): () => void
  platform: string
}

export type MenuCommand = 'open-folder' | 'rescan' | 'copy' | 'preview'
