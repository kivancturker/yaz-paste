import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  addContextFile,
  buildContextSection,
  contextFileName,
  readContextForEdit,
  writeContext,
  writeSkill,
  loadContextItems,
  loadPresets,
  parsePreset,
  readContextFile,
  serializePreset,
  slugify,
  writePreset
} from '../src/core/library'
import { renderPrompt } from '../src/core/render'
import { loadSkills } from '../src/core/skills'

const root = mkdtempSync(join(tmpdir(), 'yaz-lib-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const write = (rel: string, content: string | Buffer): string => {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
  return full
}

describe('context library', () => {
  it('lists files from all locations, the more specific one winning', async () => {
    write('project/context/guide.md', '---\ndescription: Project guide\n---\n# Guide\nproject version')
    write('user/context/guide.md', '# Guide\nuser version')
    write('user/context/examples/Order.cs', 'class Order {}')
    write('user/context/.hidden.md', 'hidden')
    write('user/context/.env', 'SECRET=1')
    write('user/context/server.pem', 'key')
    const items = await loadContextItems([
      { dir: join(root, 'project/context'), source: 'project' },
      { dir: join(root, 'user/context'), source: 'user' },
      { dir: join(root, 'missing'), source: 'built-in' }
    ])
    expect(items.map((i) => [i.id, i.source, i.description])).toEqual([
      ['examples/Order.cs', 'user', ''],
      ['guide.md', 'project', 'Project guide']
    ])
    expect(await readContextFile(items[1].file)).toBe('# Guide\nproject version')
  })

  it('renders ticked files as <additional_context> with secrets redacted', async () => {
    write('ctx/notes.txt', 'Staging DB: Server=stage;User Id=app;Password=Sup3r!x;\n')
    write('ctx/rules.md', 'Use records for DTOs.\n')
    const items = await loadContextItems([{ dir: join(root, 'ctx'), source: 'user' }])
    const out = await buildContextSection(['rules.md', 'notes.txt', 'gone.md'], items, new Set())
    expect(out.findings.map((f) => f.rule)).toEqual(['connection-string-password'])
    expect(out.warnings).toEqual([{ path: 'context/gone.md', message: 'Saved context file not found; skipped.' }])
    const text = renderPrompt({ sections: [out.section!], skills: [], task: 'Do it', format: 'xml' })
    expect(text).toBe(
      [
        '<additional_context>',
        '<document name="rules.md">',
        'Use records for DTOs.',
        '</document>',
        '',
        '<document name="notes.txt">',
        'Staging DB: Server=stage;User Id=app;Password=[REDACTED:connection-string-password];',
        '</document>',
        '',
        '</additional_context>',
        '',
        '<task>',
        'Do it',
        '</task>',
        ''
      ].join('\n')
    )
  })

  it('copies files in with the same safety checks', async () => {
    const dir = join(root, 'added')
    const src = write('src/My Notes.MD', 'notes')
    expect(await addContextFile(dir, src)).toEqual({ id: 'my-notes.md' })
    expect(await addContextFile(dir, src)).toEqual({ id: 'my-notes-2.md' })
    expect(await addContextFile(dir, write('src/.env', 'X=1'))).toEqual({ reason: expect.stringMatching(/Environment/) })
    expect(await addContextFile(dir, write('src/logo.bin', Buffer.from([0, 1, 2])))).toEqual({ reason: 'Binary file' })
    expect(readdirSync(dir).sort()).toEqual(['my-notes-2.md', 'my-notes.md'])
  })
})

describe('presets', () => {
  it('round-trips through the file format', () => {
    const md = serializePreset({ name: 'Checkout bugs', description: 'Cart & payment', skills: ['bug-fix', 'diff-patch'], context: ['a.md', 'b.md'], task: 'Bug:\n' })
    expect(md).toContain('skills:\n  - bug-fix\n  - diff-patch\n')
    expect(parsePreset(md, 'x')).toEqual({
      id: 'Checkout bugs',
      name: 'Checkout bugs',
      description: 'Cart & payment',
      skills: ['bug-fix', 'diff-patch'],
      context: ['a.md', 'b.md'],
      task: 'Bug:'
    })
    expect(parsePreset(serializePreset({ name: 'No skill', description: '', skills: [], context: [], task: '' }), 'x').skills).toEqual([])
  })

  it('still reads presets written with a single `skill:`', () => {
    expect(parsePreset('---\nname: Old\nskill: bug-fix\n---\n', 'x').skills).toEqual(['bug-fix'])
    expect(parsePreset('---\nname: Both\nskills: [refactor]\nskill: refactor\n---\n', 'x').skills).toEqual(['refactor'])
  })

  it('saves, overwrites by name, and loads with precedence', async () => {
    const dir = join(root, 'presets-user')
    const input = { name: 'Review', description: 'v1', skills: ['code-review'], context: [], task: '', scope: 'user' as const }
    await writePreset(dir, input, [])
    let loaded = await loadPresets([{ dir, source: 'user' }])
    await writePreset(dir, { ...input, description: 'v2' }, loaded)
    loaded = await loadPresets([
      { dir: join(root, 'none'), source: 'project' },
      { dir, source: 'user' }
    ])
    expect(loaded.map((p) => [p.name, p.description, p.source])).toEqual([['Review', 'v2', 'user']])
    expect(readdirSync(dir)).toEqual(['review.md'])
    await expect(writePreset(dir, { ...input, name: '  ' }, loaded)).rejects.toThrow(/name/)
  })

  it('makes safe file names', () => {
    expect(slugify('Çheckout / Bugs: v2!')).toBe('checkout-bugs-v2')
    expect(slugify('../../etc')).toBe('etc')
    expect(slugify('???')).toBe('untitled')
  })

  it('built-in presets only reference built-in skills and context files', async () => {
    const presets = await loadPresets([{ dir: resolve('presets'), source: 'built-in' }])
    const skills = new Set((await loadSkills([{ dir: resolve('skills'), source: 'built-in' }])).map((s) => s.id))
    const context = new Set((await loadContextItems([{ dir: resolve('context'), source: 'built-in' }])).map((c) => c.id))
    expect(presets.length).toBe(8)
    for (const p of presets) {
      expect(p.description).not.toBe('')
      for (const s of p.skills) expect(skills.has(s)).toBe(true)
      for (const c of p.context) expect(context.has(c)).toBe(true)
    }
    // the code-changing presets answer in the Diff tab's format
    for (const name of ['.NET bug fix', 'Node.js bug fix']) expect(presets.find((p) => p.name === name)?.skills).toEqual(['bug-fix', 'diff-patch'])
    const diffs = presets.find((p) => p.name === 'Change with diffs')
    expect(diffs).toMatchObject({ skills: ['diff-patch'], context: [] })
    expect(diffs!.task).toContain('Change:')
  })
})

describe('writing skills and context files', () => {
  it('creates a skill folder with SKILL.md and edits it in place', async () => {
    const dir = join(root, 'skills-user')
    const file = await writeSkill(dir, { name: 'API Review', description: 'Review HTTP APIs', body: 'Check status codes.' })
    expect(file).toBe(join(dir, 'api-review', 'SKILL.md'))
    let skills = await loadSkills([{ dir, source: 'user' }])
    expect(skills.map((s) => [s.name, s.description])).toEqual([['API Review', 'Review HTTP APIs']])
    await writeSkill(dir, { name: 'API Review v2', description: 'd', body: 'New body' }, file)
    skills = await loadSkills([{ dir, source: 'user' }])
    expect(skills.map((s) => s.name)).toEqual(['API Review v2'])
    await expect(writeSkill(dir, { name: 'x', description: '', body: '  ' })).rejects.toThrow(/instructions/)
  })

  it('creates, renames and protects context files', async () => {
    const dir = join(root, 'ctx-write')
    expect(contextFileName('Coding Guidelines')).toBe('coding-guidelines.md')
    expect(contextFileName('Example.CS')).toBe('example.cs')
    expect(() => contextFileName('../x.md')).toThrow()
    expect(() => contextFileName('.hidden')).toThrow()

    const id = await writeContext(dir, { name: 'guidelines', description: 'Team rules', body: 'Use records.\r\n' })
    expect(id).toBe('guidelines.md')
    expect(await readContextForEdit(join(dir, id))).toEqual({ description: 'Team rules', body: 'Use records.\n' })
    await expect(writeContext(dir, { name: 'guidelines.md', description: '', body: 'x' })).rejects.toThrow(/already exists/)
    await expect(writeContext(dir, { name: 'prod.pem', description: '', body: 'x' })).rejects.toThrow(/Private key/)

    const renamed = await writeContext(dir, { name: 'rules.txt', description: 'ignored for .txt', body: 'Use records.' }, { file: join(dir, id) })
    expect(renamed).toBe('rules.txt')
    expect(readdirSync(dir)).toEqual(['rules.txt'])
    expect(await readContextForEdit(join(dir, 'rules.txt'))).toEqual({ description: '', body: 'Use records.\n' })
  })
})
