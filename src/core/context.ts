/**
 * The shared shape every context tool produces. The Code tool emits a `project` section today; a future
 * Database tool would emit a `database` section with one block per table. Rendering, secret scanning,
 * token counting and copying are shared and don't care which tool produced the blocks.
 */

export interface ContextBlock {
  /** XML tag, e.g. "file", "directory_structure", "table". */
  tag: string
  attributes: Record<string, string>
  content: string
  /** Heading used by the Markdown renderer. */
  title: string
  /** Code-fence language for Markdown (e.g. "csharp"). */
  language?: string
  /** Consecutive blocks with the same group are wrapped in `<group>…</group>` in XML. */
  group?: string
}

export interface ContextSection {
  tag: string
  title: string
  attributes: Record<string, string>
  blocks: ContextBlock[]
}

export interface ContextTool<TRequest> {
  id: string
  displayName: string
  build(request: TRequest, signal?: AbortSignal): Promise<ContextSection>
}
