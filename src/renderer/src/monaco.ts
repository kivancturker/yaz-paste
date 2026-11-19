/**
 * Monaco is bundled locally (never loaded from a CDN) with syntax highlighting only: no language servers,
 * so a single editor worker is enough. The worker is inlined as a blob so it also loads from file:// builds.
 */
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/basic-languages/monaco.contribution'
// the icon font (folding arrows, diff markers); bundled as a local file, allowed by the CSP's font-src 'self'
import 'monaco-editor/features/codicon/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline'

;(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

/** Language ids from shared/languages.ts → ids Monaco's basic languages know. */
export function monacoLanguage(id: string): string {
  if (id === 'json') return 'javascript' // close enough for highlighting; Monaco's JSON support needs a language server
  if (id === 'text') return 'plaintext'
  return id
}

export { monaco }
