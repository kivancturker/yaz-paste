import { describe, expect, it } from 'vitest'
import { addRange, formatRanges, normalizeRanges, removeRange, renderRanges, splitLines } from '../src/shared/ranges'
import { fenceFor, renderPrompt, renderTree } from '../src/core/render'
import type { ContextSection } from '../src/core/context'

describe('ranges', () => {
  it('sorts, swaps and merges overlapping or touching ranges', () => {
    expect(normalizeRanges([[10, 5], [1, 2], [3, 4], [20, 30], [25, 40]])).toEqual([[1, 10], [20, 40]])
  })

  it('clamps to the file length', () => {
    expect(normalizeRanges([[0, 3], [8, 99]], 10)).toEqual([[1, 3], [8, 10]])
  })

  it('adds and removes lines', () => {
    expect(addRange([[1, 3]], [5, 6])).toEqual([[1, 3], [5, 6]])
    expect(removeRange([[1, 10]], [4, 5])).toEqual([[1, 3], [6, 10]])
    expect(removeRange([[4, 4]], [4, 4])).toEqual([])
  })

  it('formats ranges', () => {
    expect(formatRanges([[40, 85], [120, 120]])).toBe('40-85,120')
  })

  it('renders chosen lines with padded numbers and gap markers', () => {
    const lines = splitLines(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
    expect(lines).toHaveLength(12)
    expect(renderRanges(lines, [[2, 3], [10, 11]])).toBe([' 2: line 2', ' 3: line 3', '...', '10: line 10', '11: line 11'].join('\n'))
  })
})

describe('tree', () => {
  it('lists folders first with notes', () => {
    const tree = renderTree(['src/b.ts', 'src/api/a.ts', 'README.md'], new Map([['src/b.ts', 'lines 1-5']]))
    expect(tree).toBe(['src/', '  api/', '    a.ts', '  b.ts  ← lines 1-5', 'README.md'].join('\n'))
  })
})

describe('prompt', () => {
  const section: ContextSection = {
    tag: 'project',
    title: 'Project: shop',
    attributes: { name: 'shop', type: 'dotnet' },
    blocks: [
      { tag: 'directory_structure', attributes: {}, content: 'a.cs', title: 'Directory structure' },
      { tag: 'file', attributes: { path: 'a.cs' }, content: 'class A {}', title: 'File: a.cs', language: 'csharp', group: 'files' },
      { tag: 'file', attributes: { path: 'b "x".cs', lines: '1-2' }, content: '1: x', title: 'File: b', language: 'csharp', group: 'files' }
    ]
  }

  it('renders XML with context first and the task last', () => {
    const out = renderPrompt({ sections: [section], skill: { name: 'bug-fix', body: 'Find the bug.' }, task: 'Fix it', format: 'xml' })
    expect(out).toBe(
      [
        '<project name="shop" type="dotnet">',
        '<directory_structure>',
        'a.cs',
        '</directory_structure>',
        '',
        '<files>',
        '<file path="a.cs">',
        'class A {}',
        '</file>',
        '<file path="b &quot;x&quot;.cs" lines="1-2">',
        '1: x',
        '</file>',
        '</files>',
        '</project>',
        '',
        '<skill name="bug-fix">',
        'Find the bug.',
        '</skill>',
        '',
        '<task>',
        'Fix it',
        '</task>',
        ''
      ].join('\n')
    )
  })

  it('renders Markdown with fences that survive backticks in code', () => {
    const md = renderPrompt({ sections: [section], skill: null, task: '', format: 'markdown' })
    expect(md).toContain('## File: a.cs\n\n```csharp\nclass A {}\n```')
    expect(fenceFor('const s = ```x```')).toBe('````')
  })

  it('omits empty skill and task', () => {
    const out = renderPrompt({ sections: [], skill: null, task: '   ', format: 'xml' })
    expect(out).toBe('\n')
  })
})
