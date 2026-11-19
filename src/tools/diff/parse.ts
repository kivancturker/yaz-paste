/**
 * Finds unified diffs in an AI answer (or raw `git diff` output) and parses them.
 *
 * AI answers are messy: diffs sit inside Markdown fences (sometimes indented inside a list), prose sits between
 * them, hunk headers carry wrong line counts or no numbers at all, and blank context lines lose their leading
 * space. The parser accepts all of that, but it never guesses about content: every hunk is later checked line by
 * line against the real file (see apply.ts). Pure TypeScript with no Node or DOM imports.
 */

export type HunkLineKind = ' ' | '-' | '+'

export interface HunkLine {
  kind: HunkLineKind
  text: string
}

export interface Hunk {
  /** 1-based start line on the old side, as the header claims. Null when the header has no numbers. */
  oldStart: number | null
  oldCount: number | null
  newStart: number | null
  newCount: number | null
  /** Text after the second `@@` (often the enclosing function). */
  section: string
  lines: HunkLine[]
  /** `\ No newline at end of file` after the last old-side / new-side line. */
  oldNoNewline: boolean
  newNoNewline: boolean
  /** 1-based line of the `@@` header in the pasted text. */
  sourceLine: number
}

export interface FilePatch {
  /** Paths as written (backslashes turned into `/`), without git's `a/` / `b/` prefix handling. Null = /dev/null. */
  oldPath: string | null
  newPath: string | null
  /** True when the paths came from `--- a/…` / `+++ b/…` or `diff --git a/… b/…` (the git prefix convention). */
  gitPrefixes: boolean
  isNew: boolean
  isDeleted: boolean
  isRename: boolean
  binary: boolean
  hunks: Hunk[]
  /** Problems found while parsing (not fatal on their own). */
  warnings: string[]
  /** 1-based line of the file header in the pasted text. */
  sourceLine: number
}

export interface ParseResult {
  files: FilePatch[]
  /** Problems that don't belong to one file, e.g. a hunk with no file header. */
  warnings: string[]
}

/** A line of the input after fence handling. `boundary` lines (fences) can never be part of a hunk. */
interface Line {
  text: string
  boundary: boolean
  /** 1-based line number in the original input. */
  no: number
  /** Inside a Markdown fence, where no prose can appear. */
  inFence: boolean
}

const FENCE_OPEN = /^( *)(`{3,}|~{3,})(.*)$/

/**
 * Turns Markdown fence lines into boundaries and removes the fence's indentation from the lines inside it,
 * so a diff in a fence nested in a list item parses like any other.
 */
function prepareLines(input: string): Line[] {
  const raw = input.replace(/\r\n?/g, '\n').split('\n')
  const out: Line[] = []
  let fence: { char: string; length: number; indent: number } | null = null
  raw.forEach((text, i) => {
    const no = i + 1
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(text.slice(Math.min(fence.indent, leadingSpaces(text))))
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
        fence = null
        out.push({ text, boundary: true, no, inFence: false })
        return
      }
      out.push({ text: text.slice(Math.min(fence.indent, leadingSpaces(text))), boundary: false, no, inFence: true })
      return
    }
    const open = FENCE_OPEN.exec(text)
    // an opening backtick fence's info string can't contain backticks (CommonMark)
    if (open && !(open[2][0] === '`' && open[3].includes('`'))) {
      fence = { char: open[2][0], length: open[2].length, indent: open[1].length }
      out.push({ text, boundary: true, no, inFence: false })
      return
    }
    out.push({ text, boundary: false, no, inFence: false })
  })
  return out
}

function leadingSpaces(text: string): number {
  return /^ */.exec(text)![0].length
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/
const LOOSE_HUNK_HEADER = /^@@(?:\s.*)?$/
const GIT_HEADER = /^diff --git (.+)$/

/** Cleans a path from a `---` / `+++` line: drops a trailing timestamp, quotes, and normalizes separators. */
export function cleanPath(raw: string): string | null {
  let p = raw.replace(/\t.*$/, '').trim()
  // `--- a/x.ts 2024-01-01 10:00:00.000000000 +0000` (diff -u timestamps separated by spaces)
  p = p.replace(/\s+\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s*[+-]\d{4})?$/, '')
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = unquote(p.slice(1, -1))
  if (p === '/dev/null' || p === 'dev/null' || p === 'NUL') return null
  p = p.replace(/\\(?![\\"tn0-7])/g, '/')
  return p
}

/** git quotes paths with special characters as C strings. */
function unquote(s: string): string {
  return s.replace(/\\(["\\tn]|[0-7]{3})/g, (_, c: string) => {
    if (c === 'n') return '\n'
    if (c === 't') return '\t'
    if (c === '"' || c === '\\') return c
    return String.fromCharCode(parseInt(c, 8))
  })
}

/** `diff --git a/x b/y` → [x-with-prefix, y-with-prefix]. Only reliable when both names are equal or quoted. */
function splitGitHeader(rest: string): [string, string] | null {
  const quoted = /^"((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/.exec(rest)
  if (quoted) return [unquote(quoted[1]), unquote(quoted[2])]
  // `a/<p> b/<p>`: try every " b/" split and prefer the one where both halves name the same file
  const candidates: [string, string][] = []
  let idx = rest.indexOf(' b/')
  while (idx !== -1) {
    candidates.push([rest.slice(0, idx), rest.slice(idx + 1)])
    idx = rest.indexOf(' b/', idx + 1)
  }
  const same = candidates.find(([a, b]) => a.slice(2) === b.slice(2))
  if (same) return same
  if (candidates.length === 1) return candidates[0]
  const parts = rest.split(' ')
  return parts.length === 2 ? [parts[0], parts[1]] : null
}

function isHunkBodyLine(text: string): boolean {
  return text === '' || text[0] === ' ' || text[0] === '+' || text[0] === '-' || text[0] === '\\'
}

/** True when lines[i] starts a new file header (`--- x` directly followed by `+++ y`, or `diff --git`). */
function isFileHeaderAt(lines: Line[], i: number): boolean {
  const t = lines[i]?.text ?? ''
  if (GIT_HEADER.test(t)) return true
  return t.startsWith('--- ') && (lines[i + 1]?.text ?? '').startsWith('+++ ')
}

export function parseDiff(input: string): ParseResult {
  const lines = prepareLines(input)
  const files: FilePatch[] = []
  const warnings: string[] = []
  let current: FilePatch | null = null
  /** A `diff --git` header waiting for its `---`/`+++` lines (or none, for renames and mode changes). */
  let pendingGit: FilePatch | null = null

  const newFile = (sourceLine: number): FilePatch => ({
    oldPath: null,
    newPath: null,
    gitPrefixes: false,
    isNew: false,
    isDeleted: false,
    isRename: false,
    binary: false,
    hunks: [],
    warnings: [],
    sourceLine
  })

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const text = line.text
    if (line.boundary) {
      i++
      continue
    }

    const git = GIT_HEADER.exec(text)
    if (git) {
      const file = newFile(line.no)
      const paths = splitGitHeader(git[1])
      if (paths) {
        file.oldPath = cleanPath(paths[0])
        file.newPath = cleanPath(paths[1])
        file.gitPrefixes = true
      }
      files.push(file)
      current = file
      pendingGit = file
      i++
      // extended header lines
      while (i < lines.length && !lines[i].boundary) {
        const t = lines[i].text
        if (t.startsWith('new file mode')) file.isNew = true
        else if (t.startsWith('deleted file mode')) file.isDeleted = true
        else if (t.startsWith('rename from ')) {
          file.isRename = true
          file.oldPath = cleanPath(t.slice('rename from '.length))
          file.gitPrefixes = false
        } else if (t.startsWith('rename to ')) {
          file.isRename = true
          file.newPath = cleanPath(t.slice('rename to '.length))
          file.gitPrefixes = false
        } else if (t.startsWith('Binary files ') || t === 'GIT binary patch') file.binary = true
        else if (!/^(index |old mode |new mode |similarity index |dissimilarity index |copy from |copy to )/.test(t)) break
        i++
      }
      if (file.isNew) file.oldPath = null
      if (file.isDeleted) file.newPath = null
      continue
    }

    if (text.startsWith('--- ') && (lines[i + 1]?.text ?? '').startsWith('+++ ') && !lines[i + 1].boundary) {
      const oldRaw = text.slice(4)
      const newRaw = lines[i + 1].text.slice(4)
      const oldPath = cleanPath(oldRaw)
      const newPath = cleanPath(newRaw)
      const prefixed = (oldPath === null || oldPath.startsWith('a/')) && (newPath === null || newPath.startsWith('b/'))
      let file: FilePatch
      if (pendingGit && pendingGit.hunks.length === 0 && pendingGit === current) {
        // the ---/+++ lines of the `diff --git` block we just read
        file = pendingGit
        if (!file.isRename) {
          file.oldPath = oldPath
          file.newPath = newPath
          file.gitPrefixes = prefixed
        }
      } else {
        file = newFile(line.no)
        file.oldPath = oldPath
        file.newPath = newPath
        file.gitPrefixes = prefixed
        files.push(file)
      }
      file.isNew = file.isNew || oldPath === null
      file.isDeleted = file.isDeleted || newPath === null
      pendingGit = null
      current = file
      i += 2
      continue
    }

    if (text.startsWith('@@') && (HUNK_HEADER.test(text) || LOOSE_HUNK_HEADER.test(text) || /^@@.*@@/.test(text))) {
      if (!current) {
        warnings.push(`Line ${line.no}: a hunk without a file header (--- / +++ lines) was skipped.`)
        i = skipHunk(lines, i + 1)
        continue
      }
      const { hunk, next, warnings: hunkWarnings } = readHunk(lines, i)
      current.hunks.push(hunk)
      current.warnings.push(...hunkWarnings)
      pendingGit = null
      i = next
      continue
    }

    // prose, blank lines, anything else: not part of a diff (the current file stays open for more hunks)
    i++
  }

  for (const file of files) {
    if (!file.binary && file.hunks.length === 0 && !file.isRename && !file.isDeleted)
      file.warnings.push('No changes (hunks) found for this file.')
  }
  return { files: files.filter((f) => f.oldPath !== null || f.newPath !== null), warnings }
}

function skipHunk(lines: Line[], i: number): number {
  while (i < lines.length && !lines[i].boundary && isHunkBodyLine(lines[i].text) && !lines[i].text.startsWith('@@') && !isFileHeaderAt(lines, i))
    i++
  return i
}

function readHunk(lines: Line[], start: number): { hunk: Hunk; next: number; warnings: string[] } {
  const header = lines[start]
  const m = HUNK_HEADER.exec(header.text)
  const loose = m ? '' : (/^@@.*?@@ ?(.*)$/.exec(header.text)?.[1] ?? '')
  const hunk: Hunk = {
    oldStart: m ? Number(m[1]) : null,
    oldCount: m ? (m[2] === undefined ? 1 : Number(m[2])) : null,
    newStart: m ? Number(m[3]) : null,
    newCount: m ? (m[4] === undefined ? 1 : Number(m[4])) : null,
    section: m ? m[5] : loose,
    lines: [],
    oldNoNewline: false,
    newNoNewline: false,
    sourceLine: header.no
  }
  const warnings: string[] = []
  const counted = hunk.oldCount !== null && hunk.newCount !== null

  /** Body lines, with blank lines kept as-is so trailing ones can be trimmed afterwards. */
  const body: { text: string; no: number }[] = []
  /** Index in `body` where the header's counts were first satisfied, if they ever were. */
  let satisfiedAt: number | null = null
  let oldSeen = 0
  let newSeen = 0
  let i = start + 1

  const countsMet = (): boolean => counted && oldSeen >= hunk.oldCount! && newSeen >= hunk.newCount!

  while (i < lines.length) {
    const line = lines[i]
    const t = line.text
    if (line.boundary) break
    if (t.startsWith('@@')) break
    if (t.startsWith('\\')) {
      body.push({ text: t, no: line.no })
      i++
      continue
    }
    // `--- x` + `+++ y` is a new file header unless the counts say we're still inside this hunk
    if ((!counted || countsMet()) && isFileHeaderAt(lines, i)) break
    if (!isHunkBodyLine(t)) break
    if (countsMet() && satisfiedAt === null) satisfiedAt = body.length
    body.push({ text: t, no: line.no })
    if (t === '' || t[0] === ' ') {
      oldSeen++
      newSeen++
    } else if (t[0] === '-') oldSeen++
    else if (t[0] === '+') newSeen++
    i++
  }
  if (countsMet() && satisfiedAt === null) satisfiedAt = body.length

  // Where does the hunk really end?
  // Inside a fence nothing but the diff can follow, so every line up to the fence/next header belongs to the
  // hunk, whatever the header's counts say (AIs often miscount). In a raw paste, prose may follow the last hunk,
  // so the counts decide: lines after the point where they're met are dropped when a blank line separates them.
  let end = body.length
  const fenced = header.inFence
  if (!fenced && satisfiedAt !== null && satisfiedAt < body.length) {
    const rest = body.slice(satisfiedAt).filter((b) => !b.text.startsWith('\\'))
    if (rest.length === 0 || rest[0].text === '') end = satisfiedAt
    // otherwise the next lines continue the hunk directly: the header's counts are wrong, keep them
  }
  // keep a `\ No newline` marker that directly follows the last counted line
  while (end < body.length && body[end].text.startsWith('\\')) end++
  // trailing blank lines are separators, not context (an AI's blank context line keeps its leading space
  // in the middle of a hunk only by luck; at the end we can't tell, and the file check would catch it)
  while (end > 0 && body[end - 1].text === '') end--

  for (const b of body.slice(0, end)) {
    if (b.text.startsWith('\\')) {
      const last = hunk.lines[hunk.lines.length - 1]
      if (!last) continue
      if (last.kind === '-') hunk.oldNoNewline = true
      else if (last.kind === '+') hunk.newNoNewline = true
      else {
        hunk.oldNoNewline = true
        hunk.newNoNewline = true
      }
      continue
    }
    if (b.text === '') hunk.lines.push({ kind: ' ', text: '' })
    else hunk.lines.push({ kind: b.text[0] as HunkLineKind, text: b.text.slice(1) })
  }

  if (counted) {
    const oldN = hunk.lines.filter((l) => l.kind !== '+').length
    const newN = hunk.lines.filter((l) => l.kind !== '-').length
    if (oldN !== hunk.oldCount || newN !== hunk.newCount)
      warnings.push(
        `Hunk at line ${header.no}: the header says ${hunk.oldCount} old / ${hunk.newCount} new lines, but the hunk has ${oldN} / ${newN}. Used the lines as written.`
      )
  }
  // where parsing resumes: just after the lines we used (trailing blanks/prose are re-read as prose)
  const next = end > 0 ? lines.findIndex((l) => l.no === body[end - 1].no) + 1 : start + 1
  return { hunk, next, warnings }
}
