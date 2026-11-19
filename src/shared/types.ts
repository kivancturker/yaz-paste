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
  /** Ticked skills, in the order they go into the prompt. */
  skillIds: string[]
  format: OutputFormat
  treeMode: TreeMode
  wholeFileLineNumbers: boolean
  /** Names of the saved context files ticked for this project. */
  contextIds: string[]
  /** The preset last applied, for display only. */
  presetId: string | null
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

/** Where a skill, context file or preset comes from. */
export type LibraryScope = 'project' | 'user'

/** A saved reference file (guidelines, architecture notes, examples…) that can be added to any prompt. */
export interface ContextItem {
  /** Unique id: the file's path inside its context folder, e.g. "dotnet-conventions.md". */
  id: string
  name: string
  description: string
  source: SkillSource
  size: number
}

/** A ready-made combination of skills, context files and an optional task template. */
export interface Preset {
  /** Unique id: the preset's name. */
  id: string
  name: string
  description: string
  /** Skill ids, in prompt order. */
  skills: string[]
  context: string[]
  /** Filled into the task box when it's empty. */
  task: string
  source: SkillSource
}

export interface PresetInput {
  name: string
  description: string
  skills: string[]
  context: string[]
  task: string
  scope: LibraryScope
}

export type LibraryKind = 'skills' | 'context' | 'presets'

/** Everything needed to show and edit one skill, context file or preset. */
export interface LibraryItemDetail {
  kind: LibraryKind
  id: string
  name: string
  description: string
  /** Skill instructions, context file content, or a preset's task template. */
  body: string
  /** Presets only. */
  skills: string[]
  /** Presets only. */
  context: string[]
  source: SkillSource
  /** Built-in items are read-only; duplicate them to edit. */
  editable: boolean
  /** Where the item lives on disk, for display. */
  location: string
}

export interface LibraryItemInput {
  kind: LibraryKind
  /** The item being edited, or null to create a new one. */
  originalId: string | null
  /** Where a new item is saved. Ignored when editing. */
  scope: LibraryScope
  name: string
  description: string
  body: string
  skills: string[]
  context: string[]
}

export interface AddContextResult {
  added: string[]
  skipped: { name: string; reason: string }[]
}

export interface ComposeRequest {
  selection: Record<string, FileSelection>
  contextIds: string[]
  task: string
  /** Skills in prompt order. */
  skillIds: string[]
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
  listContext(): Promise<ContextItem[]>
  listPresets(): Promise<Preset[]>
  /** Shows a file dialog and copies the chosen files into the context library. */
  addContextFiles(scope: LibraryScope): Promise<AddContextResult>
  savePreset(input: PresetInput): Promise<Preset>
  getLibraryItem(kind: LibraryKind, id: string): Promise<LibraryItemDetail>
  saveLibraryItem(input: LibraryItemInput): Promise<LibraryItemDetail>
  /** Moves the item to the OS trash (a skill's whole folder). */
  deleteLibraryItem(kind: LibraryKind, id: string): Promise<void>
  deletePreset(id: string): Promise<void>
  /** Opens the library folder in Explorer / Finder (creating it if needed). */
  openLibraryFolder(scope: LibraryScope, kind: LibraryKind): Promise<void>
  estimate(req: ComposeRequest): Promise<TokenEstimate>
  compose(req: ComposeRequest): Promise<ComposeResult>
  copy(req: ComposeRequest): Promise<ComposeResult>
  saveState(state: ProjectState): Promise<void>
  /** Puts plain text on the clipboard (the Diff tool's rebuilt files). */
  copyText(text: string): Promise<void>
  onMenu(handler: (command: MenuCommand) => void): () => void
  platform: string
}

export type MenuCommand = 'open-folder' | 'rescan' | 'copy' | 'preview'
