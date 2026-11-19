import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadSkills, parseSkillMarkdown, readSkillBody } from '../src/core/skills'
import { parseDiff } from '../src/tools/diff/parse'
import { migrateProjectState } from '../src/shared/state'

describe('skills', () => {
  const root = mkdtempSync(join(tmpdir(), 'yaz-skills-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const skill = (base: string, folder: string, md: string): void => {
    mkdirSync(join(root, base, folder), { recursive: true })
    writeFileSync(join(root, base, folder, 'SKILL.md'), md)
  }

  it('parses frontmatter and body', () => {
    const parsed = parseSkillMarkdown('---\nname: bug-fix\ndescription: Fix bugs\n---\nBody here\n')
    expect(parsed.meta).toEqual({ name: 'bug-fix', description: 'Fix bugs' })
    expect(parsed.body).toBe('Body here\n')
  })

  it('handles Windows line endings', () => {
    const parsed = parseSkillMarkdown('---\r\nname: x\r\n---\r\nLine 1\r\nLine 2\r\n')
    expect(parsed.meta).toEqual({ name: 'x' })
    expect(parsed.body).toBe('Line 1\nLine 2\n')
  })

  it('never executes JS frontmatter and survives broken YAML', () => {
    expect(parseSkillMarkdown('---js\n{ name: (() => { throw 1 })() }\n---\nx').meta).toEqual({})
    expect(parseSkillMarkdown('---\nname: [unclosed\n---\nbody').body).toBe('body')
  })

  it('merges locations, the more specific one winning', async () => {
    skill('project', 'review', '---\nname: code-review\ndescription: Project version\n---\nProject body')
    skill('user', 'review', '---\nname: code-review\ndescription: User version\n---\nUser body')
    skill('user', 'mine', 'No frontmatter: name comes from the folder')
    writeFileSync(join(root, 'user', 'mine', 'checklist.md'), '- [ ] item')

    const skills = await loadSkills([
      { dir: join(root, 'project'), source: 'project' },
      { dir: join(root, 'user'), source: 'user' },
      { dir: join(root, 'missing'), source: 'user' }
    ])
    expect(skills.map((s) => [s.name, s.source, s.description])).toEqual([
      ['code-review', 'project', 'Project version'],
      ['mine', 'user', '']
    ])
    expect(skills[1].extraFiles).toEqual(['checklist.md'])
    expect(await readSkillBody(skills[0].file)).toBe('Project body')
  })

  it('loads every built-in skill with a name and description', async () => {
    const skills = await loadSkills([{ dir: resolve('skills'), source: 'built-in' }])
    expect(skills.length).toBe(9)
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(10)
      expect(s.name).toBe(s.dir.split(/[\\/]/).pop())
    }
  })

  it('diff-patch: its example diff is exactly what the Diff tool reads, with correct counts', () => {
    const body = parseSkillMarkdown(readFileSync(resolve('skills/diff-patch/SKILL.md'), 'utf8')).body
    const example = /````\n([\s\S]*?)\n````/.exec(body)![1]
    const { files, warnings } = parseDiff(example)
    expect(warnings).toEqual([])
    expect(files).toHaveLength(1)
    expect(files[0].warnings).toEqual([])
    const hunk = files[0].hunks[0]
    expect(hunk.lines.filter((l) => l.kind === '+')).toHaveLength(3)
    // 3 unchanged lines before the first change and after the last, as the skill asks
    expect(hunk.lines.slice(0, 3).every((l) => l.kind === ' ')).toBe(true)
    expect(hunk.lines.slice(-3).every((l) => l.kind === ' ')).toBe(true)
  })

  it('turns the single skill of older saved projects into a list', () => {
    expect(migrateProjectState({ task: 'x', skillId: 'bug-fix' })).toEqual({ task: 'x', skillIds: ['bug-fix'] })
    expect(migrateProjectState({ skillId: null })).toEqual({ skillIds: [] })
    expect(migrateProjectState({ skillIds: ['a', 'a', 3, 'b'] })).toEqual({ skillIds: ['a', 'b'] })
    expect(migrateProjectState('nope')).toBeNull()
  })
})
