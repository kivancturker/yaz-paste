/** Small inline SVG icons for the file tree (no icon font, nothing loaded from the network). */

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`chevron-icon${open ? ' open' : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="icon folder" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5V6H4.2a1.5 1.5 0 0 0-1.4 1L1.5 11V4Z" fill="currentColor" opacity="0.55" />
      <path d="M2.9 7.1A1 1 0 0 1 3.8 6.5h10.9a.8.8 0 0 1 .75 1.06l-1.7 5A1.5 1.5 0 0 1 12.3 13.5H2.2a.8.8 0 0 1-.75-1.06l1.45-5.34Z" fill="currentColor" />
    </svg>
  ) : (
    <svg className="icon folder" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 4A1.5 1.5 0 0 1 3 2.5h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 5.5V12A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4Z" fill="currentColor" />
    </svg>
  )
}

/** File colour by type, so C#, TS, config and docs are easy to tell apart. */
const KIND_BY_EXT: Record<string, string> = {
  cs: 'cs', csx: 'cs', fs: 'cs', vb: 'cs', razor: 'cs', cshtml: 'cs',
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  json: 'cfg', jsonc: 'cfg', yml: 'cfg', yaml: 'cfg', toml: 'cfg', ini: 'cfg', config: 'cfg', env: 'cfg',
  csproj: 'proj', fsproj: 'proj', vbproj: 'proj', sln: 'proj', slnx: 'proj', props: 'proj', targets: 'proj',
  xml: 'markup', html: 'markup', htm: 'markup', xaml: 'markup', vue: 'markup', svelte: 'markup',
  css: 'style', scss: 'style', less: 'style',
  md: 'doc', markdown: 'doc', txt: 'doc',
  sql: 'data', graphql: 'data', gql: 'data',
  sh: 'script', ps1: 'script', bat: 'script', cmd: 'script', dockerfile: 'script'
}

export function fileKind(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'script'
  const dot = lower.lastIndexOf('.')
  return dot < 0 ? 'other' : (KIND_BY_EXT[lower.slice(dot + 1)] ?? 'other')
}

export function FileIcon({ name }: { name: string }) {
  return (
    <svg className={`icon file kind-${fileKind(name)}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.5h5L12.5 5v8.5A1 1 0 0 1 11.5 14.5h-7.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" fill="currentColor" opacity="0.18" />
      <path d="M4 1.5h5L12.5 5v8.5A1 1 0 0 1 11.5 14.5h-7.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z M9 1.5V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}
