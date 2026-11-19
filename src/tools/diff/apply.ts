/**
 * Applies a parsed diff to the real file content, strictly.
 *
 * The rule: a hunk is applied only where ALL of its context and removed lines are found in the file. The AI's
 * line numbers are only a hint for choosing between places; they are never trusted on their own. When a hunk
 * can't be placed with certainty the file fails and no "full code" is produced, so the result is either exactly
 * what the diff describes or nothing. Context lines in the result always come from the file, never from the diff.
 *
 * Pure TypeScript with no Node or DOM imports. Text is expected with `\n` line endings.
 */
import type { FilePatch, Hunk } from './parse'

export type MatchTier = 'exact' | 'trailing-whitespace' | 'indentation'

export type HunkStatus = 'applied' | 'already-applied' | 'failed'

export interface HunkNote {
  level: 'info' | 'warn' | 'error'
  text: string
}

export interface HunkResult {
  index: number
  status: HunkStatus
  /** How the hunk's old lines were matched against the file. */
  tier: MatchTier | null
  /** 1-based line in the input file where the hunk was placed (applied) or found (already applied). */
  line: number | null
  /** 1-based line in the result where the hunk's new lines start. */
  newLine: number | null
  notes: HunkNote[]
}

export type ApplyStatus = 'clean' | 'warnings' | 'already-applied' | 'failed'

export interface ApplyResult {
  status: ApplyStatus
  /** The full new file. Null when the patch failed, or when the file is deleted. */
  content: string | null
  hunks: HunkResult[]
  /** File-level notes (not tied to one hunk). */
  notes: HunkNote[]
}

interface Lines {
  lines: string[]
  /** Whether the text ends with a newline. */
  eol: boolean
}

function toLines(text: string): Lines {
  if (text === '') return { lines: [], eol: true }
  const lines = text.split('\n')
  const eol = lines[lines.length - 1] === ''
  if (eol) lines.pop()
  return { lines, eol }
}

function fromLines({ lines, eol }: Lines): string {
  if (lines.length === 0) return ''
  return lines.join('\n') + (eol ? '\n' : '')
}

const NORMALIZE: Record<MatchTier, (s: string) => string> = {
  exact: (s) => s,
  'trailing-whitespace': (s) => s.replace(/\s+$/, ''),
  // indentation and runs of whitespace differ (tabs vs spaces, re-indented by the AI)
  indentation: (s) => s.trim().replace(/\s+/g, ' ')
}
const TIERS: MatchTier[] = ['exact', 'trailing-whitespace', 'indentation']

/** Every index where `needle` occurs in `hay` (after normalizing both), skipping the blocked line ranges. */
function findAll(hay: string[], needle: string[], tier: MatchTier, blocked: [number, number][]): number[] {
  const norm = NORMALIZE[tier]
  const h = hay.map(norm)
  const n = needle.map(norm)
  const found: number[] = []
  outer: for (let p = 0; p + n.length <= h.length; p++) {
    for (const [a, b] of blocked) if (p < b && p + n.length > a) continue outer
    for (let k = 0; k < n.length; k++) if (h[p + k] !== n[k]) continue outer
    found.push(p)
  }
  return found
}

/** A blank-lines-only block matches almost anywhere, so it can't place a hunk on its own. */
function isTrivial(block: string[]): boolean {
  return block.every((l) => l.trim() === '')
}

interface Placement {
  hunkIndex: number
  /** 0-based index in the file where the old block starts. */
  at: number
  /** Number of file lines the old block covers. */
  length: number
  hunk: Hunk
}

/** Describes why the old block wasn't found: the place where most of it matches and the first line that differs. */
function explainMismatch(file: string[], oldBlock: string[], hint: number | null): string {
  if (oldBlock.length === 0) return 'The hunk has no context lines to find its place.'
  const norm = NORMALIZE.indentation
  let best = { at: -1, score: -1 }
  for (let p = 0; p < Math.max(1, file.length); p++) {
    let score = 0
    for (let k = 0; k < oldBlock.length && p + k < file.length; k++) if (norm(file[p + k]) === norm(oldBlock[k])) score++
    const closer = hint !== null && best.at >= 0 && Math.abs(p - hint) < Math.abs(best.at - hint)
    if (score > best.score || (score === best.score && closer)) best = { at: p, score }
  }
  if (best.score <= 0) return `None of the hunk's ${oldBlock.length} context/removed lines were found near each other in the file.`
  for (let k = 0; k < oldBlock.length; k++) {
    const actual = file[best.at + k]
    if (actual === undefined)
      return `Closest match is at line ${best.at + 1}, but the file ends before the hunk's line ${k + 1} (“${clip(oldBlock[k])}”).`
    if (norm(actual) !== norm(oldBlock[k]))
      return `Closest match starts at line ${best.at + 1} (${best.score}/${oldBlock.length} lines match). Line ${best.at + k + 1} is “${clip(actual)}”, but the diff expects “${clip(oldBlock[k])}”.`
  }
  return `Closest match is at line ${best.at + 1}.`
}

function clip(s: string): string {
  const t = s.trim()
  return t.length > 80 ? t.slice(0, 77) + '…' : t
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Applies one file's patch to its current content.
 * @param original the file's current text, or null when the file doesn't exist.
 */
export function applyPatch(original: string | null, patch: FilePatch): ApplyResult {
  const notes: HunkNote[] = []

  if (patch.binary) {
    return { status: 'failed', content: null, hunks: [], notes: [{ level: 'error', text: 'Binary patches can’t be applied.' }] }
  }

  // ---- new file ----
  if (patch.isNew) {
    const added: string[] = []
    let eol = true
    for (const h of patch.hunks) {
      if (h.lines.some((l) => l.kind !== '+'))
        return fail('A new file’s diff should only add lines, but this one has context or removed lines.')
      added.push(...h.lines.map((l) => l.text))
      if (h.newNoNewline) eol = false
    }
    const content = fromLines({ lines: added, eol })
    const hunks = patch.hunks.map((_, index): HunkResult => ({ index, status: 'applied', tier: 'exact', line: 1, newLine: 1, notes: [] }))
    if (original !== null) {
      if (original === content || toLines(original).lines.join('\n') === added.join('\n'))
        return { status: 'already-applied', content: original, hunks: hunks.map((h) => ({ ...h, status: 'already-applied' })), notes: [{ level: 'info', text: 'This file already exists with exactly this content.' }] }
      return fail('The diff creates this file, but a file with different content already exists at this path.')
    }
    return { status: 'clean', content, hunks, notes }
  }

  if (original === null) return fail('The file to change was not found.')

  // ---- deleted file ----
  if (patch.isDeleted) {
    const file = toLines(original).lines
    const removed = patch.hunks.flatMap((h) => h.lines.filter((l) => l.kind !== '+').map((l) => l.text))
    if (patch.hunks.length && removed.join('\n') !== file.join('\n'))
      return fail('The diff deletes this file, but the lines it lists don’t match the file’s current content.')
    return { status: 'clean', content: null, hunks: patch.hunks.map((_, index) => ({ index, status: 'applied', tier: 'exact', line: 1, newLine: 1, notes: [] })), notes: [{ level: 'info', text: 'The file is deleted.' }] }
  }

  // ---- changed file ----
  const file = toLines(original)
  const hunkResults: HunkResult[] = []
  const placements: Placement[] = []
  const blocked: [number, number][] = []
  /** How far the previous hunk landed from where its header said (patch/git apply track this too). */
  let drift = 0

  patch.hunks.forEach((hunk, index) => {
    const result: HunkResult = { index, status: 'failed', tier: null, line: null, newLine: null, notes: [] }
    hunkResults.push(result)
    const oldBlock = hunk.lines.filter((l) => l.kind !== '+').map((l) => l.text)
    const newBlock = hunk.lines.filter((l) => l.kind !== '-').map((l) => l.text)
    const changes = hunk.lines.some((l) => l.kind !== ' ')
    if (!changes) {
      result.status = 'applied'
      result.notes.push({ level: 'info', text: 'This hunk has no added or removed lines.' })
      return
    }
    // where the header says the old block starts (0-based), adjusted by earlier hunks' drift
    const hint = hunk.oldStart === null ? null : Math.max(0, (hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1) + drift)

    // a pure insertion with no context can only be placed by its line number
    if (oldBlock.length === 0) {
      if (hint === null || hint > file.lines.length) {
        result.notes.push({ level: 'error', text: 'This hunk only adds lines and has no context lines or line number to place them.' })
        return
      }
      if (blocked.some(([a, b]) => hint > a && hint < b)) {
        result.notes.push({ level: 'error', text: 'This hunk overlaps another hunk.' })
        return
      }
      placements.push({ hunkIndex: index, at: hint, length: 0, hunk })
      blocked.push([hint, hint])
      result.status = 'applied'
      result.tier = 'exact'
      result.line = hint + 1
      if (file.lines.length > 0)
        result.notes.push({ level: 'warn', text: `No context lines: placed only by the line number in the diff (after line ${hint}). Check it.` })
      return
    }

    for (const tier of TIERS) {
      const found = findAll(file.lines, oldBlock, tier, blocked)
      if (found.length === 0) continue
      // blank lines are everywhere: with several matches, only the exact line number may place them
      if (isTrivial(oldBlock) && found.length > 1 && (hint === null || !found.includes(hint))) {
        result.notes.push({ level: 'error', text: 'The hunk’s only context is blank lines, which appear in many places, and the line number doesn’t point at one; can’t place it safely.' })
        return
      }
      let at: number
      if (found.length === 1) at = found[0]
      else if (hint === null) {
        result.notes.push({
          level: 'error',
          text: `The hunk’s lines appear ${found.length} times in the file (lines ${found.slice(0, 5).map((f) => f + 1).join(', ')}${found.length > 5 ? ', …' : ''}) and the diff gives no line number to choose.`
        })
        return
      } else {
        // Several places match. The line number may only pick one if it points at it exactly: a "closest"
        // guess would be wrong whenever the AI's numbers are off. Even then it's flagged, because a wrong line
        // number can land on the wrong copy by coincidence.
        const where = `lines ${found.slice(0, 6).map((f) => f + 1).join(', ')}${found.length > 6 ? ', …' : ''}`
        if (!found.includes(hint)) {
          result.notes.push({
            level: 'error',
            text: `The hunk’s lines appear ${found.length} times (${where}) and the diff’s line number (${hint + 1}) doesn’t point at any of them, so the right place is unknown. Ask the AI for more context lines.`
          })
          return
        }
        at = hint
        result.notes.push({
          level: 'warn',
          text: `The hunk’s lines appear ${found.length} times (${where}); placed at line ${at + 1}, where the diff’s line number points. Check it’s the right one.`
        })
      }
      placements.push({ hunkIndex: index, at, length: oldBlock.length, hunk })
      blocked.push([at, at + oldBlock.length])
      result.status = 'applied'
      result.tier = tier
      result.line = at + 1
      if (hint !== null && at !== hint) {
        if (found.length === 1) result.notes.push({ level: 'info', text: `Found at line ${at + 1} (the diff said ${hint + 1 - drift}).` })
        drift = at - (hint - drift)
      }
      if (tier === 'trailing-whitespace') result.notes.push({ level: 'info', text: 'Matched ignoring trailing whitespace.' })
      if (tier === 'indentation')
        result.notes.push({ level: 'warn', text: 'Matched only when ignoring indentation/spacing. Context lines keep the file’s indentation; check the indentation of the added lines.' })
      return
    }

    // not found: maybe the change is already in the file
    if (!isTrivial(newBlock)) {
      for (const tier of TIERS.slice(0, 2)) {
        const found = findAll(file.lines, newBlock, tier, blocked)
        if (found.length === 1) {
          const at = found[0]
          result.status = 'already-applied'
          result.tier = tier
          result.line = at + 1
          result.notes.push({ level: 'info', text: `This change is already in the file (line ${at + 1}).` })
          blocked.push([at, at + newBlock.length])
          return
        }
      }
    }
    result.notes.push({ level: 'error', text: explainMismatch(file.lines, oldBlock, hint) })
  })

  if (hunkResults.some((h) => h.status === 'failed')) {
    const failed = hunkResults.filter((h) => h.status === 'failed').length
    notes.push({ level: 'error', text: `${plural(failed, 'hunk')} of ${patch.hunks.length} couldn’t be placed, so no full file is produced.` })
    return { status: 'failed', content: null, hunks: hunkResults, notes }
  }

  // build the new file: untouched lines and context come from the file, added lines from the diff
  placements.sort((a, b) => a.at - b.at || a.hunkIndex - b.hunkIndex)
  const out: string[] = []
  let cursor = 0
  let eol = file.eol
  for (const p of placements) {
    out.push(...file.lines.slice(cursor, p.at))
    hunkResults[p.hunkIndex].newLine = out.length + 1
    let k = p.at
    for (const l of p.hunk.lines) {
      if (l.kind === ' ') out.push(file.lines[k++])
      else if (l.kind === '-') k++
      else out.push(l.text)
    }
    cursor = p.at + p.length
    if (cursor === file.lines.length) {
      if (p.hunk.newNoNewline) eol = false
      else if (p.hunk.oldNoNewline) eol = true
    }
  }
  out.push(...file.lines.slice(cursor))

  // an already-applied hunk sits in unchanged text: shift its line by the changes placed above it
  for (const h of hunkResults) {
    if (h.status !== 'already-applied' || h.line === null) continue
    let shift = 0
    for (const p of placements) if (p.at < h.line - 1) shift += p.hunk.lines.filter((l) => l.kind === '+').length - p.length + p.hunk.lines.filter((l) => l.kind === ' ').length
    h.newLine = h.line + shift
  }

  const allAlready = hunkResults.every((h) => h.status === 'already-applied')
  const someAlready = hunkResults.some((h) => h.status === 'already-applied')
  if (someAlready && !allAlready) notes.push({ level: 'warn', text: 'Some hunks are already in the file and were skipped.' })
  const hasWarn = hunkResults.some((h) => h.notes.some((n) => n.level === 'warn')) || notes.some((n) => n.level === 'warn')
  return {
    status: allAlready ? 'already-applied' : hasWarn ? 'warnings' : 'clean',
    content: fromLines({ lines: out, eol }),
    hunks: hunkResults,
    notes
  }

  function fail(text: string): ApplyResult {
    return { status: 'failed', content: null, hunks: [], notes: [{ level: 'error', text }] }
  }
}

/**
 * Applies several patches for the same file one after another (AIs sometimes split one file's changes into
 * separate diff blocks). Each patch is matched against the result of the previous one.
 */
export function applyPatches(original: string | null, patches: FilePatch[]): ApplyResult {
  let content = original
  const hunks: HunkResult[] = []
  const notes: HunkNote[] = []
  let status: ApplyStatus = 'clean'
  let offset = 0
  for (const patch of patches) {
    const r = applyPatch(content, patch)
    hunks.push(...r.hunks.map((h) => ({ ...h, index: h.index + offset })))
    notes.push(...r.notes)
    offset += patch.hunks.length
    if (r.status === 'failed') return { status: 'failed', content: null, hunks, notes }
    if (r.status === 'warnings') status = 'warnings'
    else if (r.status === 'already-applied' && status === 'clean' && patches.length === 1) status = 'already-applied'
    content = r.content
    if (content === null && patch !== patches[patches.length - 1]) {
      notes.push({ level: 'error', text: 'The file is deleted by one diff block and changed by another.' })
      return { status: 'failed', content: null, hunks, notes }
    }
  }
  if (patches.length > 1 && hunks.every((h) => h.status === 'already-applied')) status = 'already-applied'
  if (patches.length > 1) notes.unshift({ level: 'info', text: `${patches.length} separate diff blocks change this file; they were applied in order.` })
  return { status, content, hunks, notes }
}
