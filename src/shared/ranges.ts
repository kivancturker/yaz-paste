import type { LineRange } from './types'

/** Sorts ranges, swaps reversed ones, clamps to [1, maxLine] and merges overlapping or touching ranges. */
export function normalizeRanges(ranges: LineRange[], maxLine = Number.MAX_SAFE_INTEGER): LineRange[] {
  const cleaned = ranges
    .map(([a, b]): LineRange => [Math.min(a, b), Math.max(a, b)])
    .map(([a, b]): LineRange => [Math.max(1, a), Math.min(maxLine, b)])
    .filter(([a, b]) => a <= b)
    .sort((x, y) => x[0] - y[0])

  const merged: LineRange[] = []
  for (const r of cleaned) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Adds `range`, merging as needed. */
export function addRange(ranges: LineRange[], range: LineRange): LineRange[] {
  return normalizeRanges([...ranges, range])
}

/** Removes lines [a, b] from the ranges, splitting a range when needed. */
export function removeRange(ranges: LineRange[], [a, b]: LineRange): LineRange[] {
  const out: LineRange[] = []
  for (const [s, e] of ranges) {
    if (e < a || s > b) out.push([s, e])
    else {
      if (s < a) out.push([s, a - 1])
      if (e > b) out.push([b + 1, e])
    }
  }
  return normalizeRanges(out)
}

export function formatRanges(ranges: LineRange[]): string {
  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')
}

export function countRangeLines(ranges: LineRange[]): number {
  return ranges.reduce((sum, [a, b]) => sum + (b - a + 1), 0)
}

export function splitLines(content: string): string[] {
  const lines = content.split('\n')
  // a trailing newline doesn't start a new line
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Renders the chosen lines with line numbers. Gaps between ranges are marked with `...`.
 * `lines` are the file's lines (already redacted).
 */
export function renderRanges(lines: string[], ranges: LineRange[]): string {
  const normalized = normalizeRanges(ranges, lines.length)
  if (normalized.length === 0) return ''
  const width = String(normalized[normalized.length - 1][1]).length
  const parts: string[] = []
  normalized.forEach(([a, b], i) => {
    if (i > 0) parts.push('...')
    for (let n = a; n <= b; n++) parts.push(`${String(n).padStart(width, ' ')}: ${lines[n - 1]}`)
  })
  return parts.join('\n')
}

export function withLineNumbers(lines: string[]): string {
  const width = String(lines.length).length
  return lines.map((line, i) => `${String(i + 1).padStart(width, ' ')}: ${line}`).join('\n')
}
