import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { applyPatch, applyPatches } from '../src/tools/diff/apply'
import { parseDiff } from '../src/tools/diff/parse'
import { groupPatches, resolvePath } from '../src/tools/diff/resolve'

const ORDER = `using System;

namespace Shop.Api.Services;

public class OrderService
{
    public async Task<Order> CreateAsync(CreateOrder cmd)
    {
        var order = new Order(cmd.CustomerId);
        foreach (var item in cmd.Items)
            order.Add(item);
        await _db.SaveChangesAsync();
        return order;
    }
}
`

function only(text: string) {
  const parsed = parseDiff(text)
  expect(parsed.files).toHaveLength(1)
  return parsed.files[0]
}

describe('parseDiff', () => {
  it('finds a diff inside a Markdown answer with prose around it', () => {
    const answer = `The bug is that empty orders are saved.

\`\`\`diff
--- a/src/Shop.Api/Services/OrderService.cs
+++ b/src/Shop.Api/Services/OrderService.cs
@@ -7,5 +7,7 @@ public class OrderService
     public async Task<Order> CreateAsync(CreateOrder cmd)
     {
+        if (cmd.Items.Count == 0)
+            throw new ValidationException("An order needs at least one item.");
         var order = new Order(cmd.CustomerId);
         foreach (var item in cmd.Items)
             order.Add(item);
\`\`\`

- This keeps the API returning 400 instead of 500.
`
    const file = only(answer)
    expect(file.oldPath).toBe('a/src/Shop.Api/Services/OrderService.cs')
    expect(file.gitPrefixes).toBe(true)
    expect(file.hunks).toHaveLength(1)
    expect(file.hunks[0]).toMatchObject({ oldStart: 7, oldCount: 5, newStart: 7, newCount: 7, section: 'public class OrderService' })
    expect(file.hunks[0].lines.filter((l) => l.kind === '+')).toHaveLength(2)
    expect(file.warnings).toEqual([])
  })

  it('reads several files and several hunks from raw git diff output', () => {
    const text = `diff --git a/x.ts b/x.ts
index 1111111..2222222 100644
--- a/x.ts
+++ b/x.ts
@@ -1,3 +1,3 @@
 a
-b
+B
 c
@@ -10,2 +10,3 @@ function f() {
 j
+k2
 k
diff --git a/y.ts b/y.ts
new file mode 100644
--- /dev/null
+++ b/y.ts
@@ -0,0 +1,2 @@
+one
+two
`
    const { files } = parseDiff(text)
    expect(files.map((f) => [f.oldPath, f.newPath, f.isNew, f.hunks.length])).toEqual([
      ['a/x.ts', 'b/x.ts', false, 2],
      [null, 'b/y.ts', true, 1]
    ])
  })

  it('handles a fence nested in a list item (indented)', () => {
    const text = `1. Change the service:
   \`\`\`diff
   --- a/x.txt
   +++ b/x.txt
   @@ -1,2 +1,2 @@
    keep
   -old
   +new
   \`\`\`
2. Done.`
    const file = only(text)
    expect(file.hunks[0].lines).toEqual([
      { kind: ' ', text: 'keep' },
      { kind: '-', text: 'old' },
      { kind: '+', text: 'new' }
    ])
  })

  it('keeps lines after a wrong header count inside a fence (AIs miscount)', () => {
    const text = '```diff\n--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n c\n-d\n+D\n```'
    const file = only(text)
    expect(file.hunks[0].lines.map((l) => l.kind + l.text)).toEqual([' a', '-b', '+B', ' c', '-d', '+D'])
    expect(file.warnings[0]).toMatch(/header says 2 old \/ 2 new/)
  })

  it('stops at the header count in a raw paste when prose follows after a blank line', () => {
    const text = '--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n\n- a bullet point in the explanation\n'
    const file = only(text)
    expect(file.hunks[0].lines.map((l) => l.kind + l.text)).toEqual([' a', '-b', '+B'])
  })

  it('accepts hunk headers without line numbers', () => {
    const file = only('--- a/f\n+++ b/f\n@@ ... @@\n a\n-b\n+c\n')
    expect(file.hunks[0].oldStart).toBeNull()
    expect(file.hunks[0].lines).toHaveLength(3)
  })

  it('treats a blank line inside a hunk as a blank context line', () => {
    const file = only('```diff\n--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n```')
    expect(file.hunks[0].lines.map((l) => l.kind + l.text)).toEqual([' a', ' ', '-b', '+B'])
  })

  it('reads `\\ No newline at end of file`', () => {
    const file = only('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n')
    expect(file.hunks[0]).toMatchObject({ oldNoNewline: true, newNoNewline: true })
  })

  it('reads renames and deletions', () => {
    const { files } = parseDiff(
      'diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\ndiff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n'
    )
    expect(files[0]).toMatchObject({ oldPath: 'old.ts', newPath: 'new.ts', isRename: true, gitPrefixes: false })
    expect(files[1]).toMatchObject({ isDeleted: true, newPath: null })
  })

  it('normalizes CRLF and Windows paths', () => {
    const file = only('--- a\\src\\x.cs\r\n+++ b\\src\\x.cs\r\n@@ -1 +1 @@\r\n-a\r\n+b\r\n')
    expect(file.oldPath).toBe('a/src/x.cs')
    expect(file.hunks[0].lines).toEqual([
      { kind: '-', text: 'a' },
      { kind: '+', text: 'b' }
    ])
  })

  it('does not take a removed SQL comment for a file header while the counts are open', () => {
    const file = only('--- a/q.sql\n+++ b/q.sql\n@@ -1,2 +1,2 @@\n--- old comment\n+++ new comment\n select 1;\n')
    expect(file.hunks[0].lines.map((l) => l.kind + l.text)).toEqual(['--- old comment', '+++ new comment', ' select 1;'])
  })
})

describe('applyPatch', () => {
  const patchFor = (body: string) => only(`--- a/OrderService.cs\n+++ b/OrderService.cs\n${body}`)

  it('applies a clean hunk and keeps everything else byte for byte', () => {
    const r = applyPatch(
      ORDER,
      patchFor(`@@ -12,3 +12,4 @@
         await _db.SaveChangesAsync();
+        _log.Created(order.Id);
         return order;
     }
`)
    )
    expect(r.status).toBe('clean')
    expect(r.content).toBe(ORDER.replace('        return order;', '        _log.Created(order.Id);\n        return order;'))
  })

  it('finds the hunk when the line numbers are off (and says so)', () => {
    const r = applyPatch(ORDER, patchFor('@@ -40,2 +40,2 @@\n         var order = new Order(cmd.CustomerId);\n-        foreach (var item in cmd.Items)\n+        foreach (var item in cmd.Items.Distinct())\n'))
    expect(r.status).toBe('clean')
    expect(r.hunks[0].line).toBe(9)
    expect(r.hunks[0].notes[0].text).toMatch(/Found at line 9/)
    expect(r.content).toContain('cmd.Items.Distinct()')
  })

  it('refuses when a context line does not match, and explains where', () => {
    const r = applyPatch(ORDER, patchFor('@@ -9,2 +9,2 @@\n         var order = new Order(cmd.Customer);\n-        foreach (var item in cmd.Items)\n+        foreach (var item in items)\n'))
    expect(r.status).toBe('failed')
    expect(r.content).toBeNull()
    expect(r.hunks[0].notes[0].text).toMatch(/Line 9 is “var order = new Order\(cmd.CustomerId\);”, but the diff expects “var order = new Order\(cmd.Customer\);”/)
  })

  it('fails the whole file if any hunk fails (no half-applied output)', () => {
    const r = applyPatch(
      ORDER,
      patchFor('@@ -1 +1 @@\n-using System;\n+using System.Linq;\n@@ -12 +12 @@\n-        await _db.SaveChanges();\n+        await _db.SaveChangesAsync(ct);\n')
    )
    expect(r.status).toBe('failed')
    expect(r.hunks.map((h) => h.status)).toEqual(['applied', 'failed'])
    expect(r.content).toBeNull()
  })

  it('matches when only trailing whitespace differs, keeping the file’s own lines', () => {
    const file = 'a  \nb\nc\n'
    const r = applyPatch(file, only('--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'))
    expect(r.status).toBe('clean')
    expect(r.content).toBe('a  \nB\nc\n')
    expect(r.hunks[0].tier).toBe('trailing-whitespace')
  })

  it('matches across tabs/spaces only with a warning', () => {
    const file = '\tif (x)\n\t\treturn 1;\n'
    const r = applyPatch(file, only('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n     if (x)\n-        return 1;\n+        return 2;\n'))
    expect(r.status).toBe('warnings')
    expect(r.hunks[0].tier).toBe('indentation')
    expect(r.content).toBe('\tif (x)\n        return 2;\n')
  })

  it('places a repeated block only where the line number points exactly, and flags it', () => {
    const file = 'x\n}\n\ny\n}\n\nz\n}\n'
    const r = applyPatch(file, only('--- a/f\n+++ b/f\n@@ -5,2 +5,3 @@\n }\n+// end y\n \n'))
    expect(r.status).toBe('warnings')
    expect(r.content).toBe('x\n}\n\ny\n}\n// end y\n\nz\n}\n')
    // one line off: no "closest" guessing
    const off = applyPatch(file, only('--- a/f\n+++ b/f\n@@ -4,2 +4,3 @@\n }\n+// end\n \n'))
    expect(off.status).toBe('failed')
    expect(off.hunks[0].notes[0].text).toMatch(/appear 2 times \(lines 2, 5\)/)
  })

  it('refuses repeated blocks when there is no line number', () => {
    const r = applyPatch('}\n}\n', only('--- a/f\n+++ b/f\n@@\n-}\n+};\n'))
    expect(r.status).toBe('failed')
    expect(r.hunks[0].notes[0].text).toMatch(/appear 2 times/)
  })

  it('recognizes a change that is already in the file', () => {
    const r = applyPatch('a\nB\nc\n', only('--- a/f\n+++ b/f\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'))
    expect(r.status).toBe('already-applied')
    expect(r.content).toBe('a\nB\nc\n')
  })

  it('applies hunks given out of order', () => {
    const r = applyPatch('1\n2\n3\n4\n5\n6\n7\n8\n', only('--- a/f\n+++ b/f\n@@ -7,2 +7,2 @@\n 7\n-8\n+eight\n@@ -1,2 +1,2 @@\n-1\n+one\n 2\n'))
    expect(r.content).toBe('one\n2\n3\n4\n5\n6\n7\neight\n')
  })

  it('creates new files and refuses to overwrite a different existing one', () => {
    const patch = only('--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+export const a = 1\n+export const b = 2\n')
    expect(applyPatch(null, patch)).toMatchObject({ status: 'clean', content: 'export const a = 1\nexport const b = 2\n' })
    expect(applyPatch('other\n', patch).status).toBe('failed')
  })

  it('keeps or drops the final newline as the diff says', () => {
    const r = applyPatch('a\nb', only('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n'))
    expect(r.content).toBe('a\nc\n')
    const keep = applyPatch('a\nb', only('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+A\n'))
    expect(keep.content).toBe('A\nb')
  })

  it('applies separate diff blocks for the same file in order', () => {
    const { files } = parseDiff('```diff\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+A\n```\ntext\n```diff\n--- a/f\n+++ b/f\n@@ -3 +3 @@\n-c\n+C\n```')
    const groups = groupPatches(files, ['f'])
    expect(groups).toHaveLength(1)
    expect(applyPatches('a\nb\nc\n', groups[0].patches).content).toBe('A\nb\nC\n')
  })
})

describe('resolvePath', () => {
  const files = ['src/Shop.Api/Services/OrderService.cs', 'src/Shop.Api/Program.cs', 'src/Shop.Worker/Program.cs', 'a/readme.md']
  it('strips git prefixes', () => expect(resolvePath('a/src/Shop.Api/Program.cs', true, files).path).toBe('src/Shop.Api/Program.cs'))
  it('keeps a real folder named a/', () => expect(resolvePath('a/readme.md', false, files).path).toBe('a/readme.md'))
  it('matches a unique suffix', () => {
    const r = resolvePath('Services/OrderService.cs', false, files)
    expect(r.path).toBe('src/Shop.Api/Services/OrderService.cs')
    expect(r.note).toMatch(/matched to/)
  })
  it('refuses an ambiguous suffix', () => {
    const r = resolvePath('Program.cs', false, files)
    expect(r.path).toBeNull()
    expect(r.note).toMatch(/matches 2 files/)
  })
})

// ---- fuzz: real `git diff` output must rebuild the new file exactly ----

const dir = mkdtempSync(join(tmpdir(), 'yaz-diff-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function rng(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

function gitDiff(a: string, b: string, context: number): string {
  writeFileSync(join(dir, 'a.txt'), a)
  writeFileSync(join(dir, 'b.txt'), b)
  try {
    return execFileSync('git', ['diff', '--no-index', '--no-color', `-U${context}`, 'a.txt', 'b.txt'], { cwd: dir, encoding: 'utf8' })
  } catch (err) {
    return (err as { stdout: string }).stdout // exit code 1 means "files differ"
  }
}

// spawning git hundreds of times is slow (more so on Windows), hence the long timeouts
describe('fuzz against git diff', () => {
  // a small vocabulary makes repeated lines (the hard case) common
  const words = ['{', '}', '', 'return x;', 'i++;', 'foo();', 'bar();', '// note', 'if (a)', 'else']
  const random = rng(42)
  const pick = <T,>(xs: T[]): T => xs[Math.floor(random() * xs.length)]

  function randomFile(): string {
    const n = 1 + Math.floor(random() * 40)
    const lines = Array.from({ length: n }, () => (random() < 0.5 ? pick(words) : `line ${Math.floor(random() * 1000)}`))
    return lines.join('\n') + (random() < 0.85 ? '\n' : '')
  }

  function mutate(text: string): string {
    const lines = text.split('\n')
    const edits = 1 + Math.floor(random() * 5)
    for (let e = 0; e < edits; e++) {
      const at = Math.floor(random() * (lines.length + 1))
      const r = random()
      if (r < 0.33) lines.splice(at, 0, `added ${Math.floor(random() * 1000)}`)
      else if (r < 0.66) lines.splice(at, 1)
      else lines.splice(at, 1, pick(words))
    }
    return lines.join('\n')
  }

  it('rebuilds the new file exactly from git diff -U3 / -U1 / -U0, and anything "clean" is always right', () => {
    let checked = 0
    for (let round = 0; round < 300; round++) {
      const before = randomFile()
      const after = mutate(before)
      if (before === after) continue
      const context = pick([0, 1, 3])
      const diff = gitDiff(before, after, context)
      const { files } = parseDiff(diff)
      expect(files).toHaveLength(1)
      const r = applyPatch(before, files[0])
      // with the real line numbers git gives, every hunk must apply and the result must be exact
      expect(r.status, diff).not.toBe('failed')
      expect(r.content, diff).toBe(after)
      checked++
    }
    expect(checked).toBeGreaterThan(250)
  }, 60_000)

  it('with wrong or missing line numbers (like an AI writes) it is exact or it says so: "clean" is never wrong', () => {
    const tally = { clean: 0, flagged: 0, refused: 0 }
    for (let round = 0; round < 600; round++) {
      const before = randomFile()
      const after = mutate(before)
      if (before === after) continue
      let diff = gitDiff(before, after, pick([0, 1, 3]))
      const mode = pick(['same', 'random', 'strip'])
      const same = Math.floor(random() * 21) - 10
      if (mode === 'strip') diff = diff.replace(/^@@ .*$/gm, '@@')
      else
        diff = diff.replace(/^@@ -(\d+)/gm, (_, n: string) => {
          const shift = mode === 'same' ? same : Math.floor(random() * 41) - 20
          return `@@ -${Math.max(1, Number(n) + shift)}`
        })
      const r = applyPatch(before, parseDiff(diff).files[0])
      if (r.status === 'clean') {
        expect(r.content, diff).toBe(after)
        tally.clean++
      } else if (r.status === 'failed') {
        expect(r.content).toBeNull()
        tally.refused++
      } else tally.flagged++
    }
    expect(tally.clean).toBeGreaterThan(300)
  }, 60_000)
})
