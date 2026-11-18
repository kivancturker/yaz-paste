import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { codeContextTool } from '../src/tools/code/compose'
import { decodeText, FileReader, resolveInside } from '../src/tools/code/files'
import { blockReason, expandBraces, isSensitive } from '../src/tools/code/rules'
import { scanProject } from '../src/tools/code/scan'
import { renderPrompt } from '../src/core/render'
import type { FileEntry } from '../src/shared/types'

const AWS_KEY = 'AKIA' + 'Q3EXAMPL7TESTKEY'

describe('block list', () => {
  it('blocks secret files and allows examples', () => {
    expect(blockReason('.env')).toMatch(/Environment/)
    expect(blockReason('src/Api/.env.production')).toMatch(/Environment/)
    expect(blockReason('.env.example')).toBeNull()
    expect(blockReason('certs/server.pfx')).toMatch(/Private key/)
    expect(blockReason('home/.ssh/id_ed25519')).toBeTruthy()
    expect(blockReason('src/Api/Properties/PublishProfiles/Prod.pubxml')).toMatch(/publish profile/)
    expect(blockReason('secrets.json')).toBeTruthy()
    expect(blockReason('.npmrc')).toBeTruthy()
    expect(blockReason('src/Api/Program.cs')).toBeNull()
  })

  it('marks config files as sensitive', () => {
    expect(isSensitive('src/Api/appsettings.Development.json')).toBe(true)
    expect(isSensitive('src/Api/web.config')).toBe(true)
    expect(isSensitive('src/Api/Program.cs')).toBe(false)
  })

  it('expands braces for gitignore patterns', () => {
    expect(expandBraces('*.{png,jpg}')).toEqual(['*.png', '*.jpg'])
  })
})

describe('files', () => {
  it('decodes BOMs, UTF-16 and CRLF', () => {
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62])).content).toBe('a\nb')
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi\r\nthere', 'utf16le')])
    expect(decodeText(utf16)).toEqual({ content: 'hi\nthere', binary: false })
    expect(decodeText(Buffer.from([0x50, 0x4b, 0x00, 0x01])).binary).toBe(true)
  })
})

describe('project scan and compose', () => {
  let root: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'yaz-test-'))
    const write = (rel: string, content: string): void => {
      const full = join(root, rel)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, content)
    }
    write('Shop.sln', '')
    write('src/Api/Api.csproj', '<Project />')
    write('src/Api/Program.cs', 'var app = builder.Build();\napp.Run();\n')
    write('src/Api/appsettings.json', '{\n  "ConnectionStrings": {\n    "Default": "Server=db;Database=Shop;User Id=app;Password=Hunter2x;"\n  }\n}\n')
    write('src/Api/bin/Debug/Api.dll', 'MZ')
    write('src/Api/obj/project.assets.json', '{}')
    write('src/Api/Services/OrderService.cs', ['class OrderService', '{', `  const string Key = "${AWS_KEY}";`, '  void Create() {}', '}'].join('\n') + '\n')
    write('.env', 'API_KEY=abc')
    write('.env.example', 'API_KEY=your-key-here')
    write('.gitignore', 'secret-notes.txt\n')
    write('secret-notes.txt', 'ignored by gitignore')
    write('docs/.gitignore', '*.tmp\n')
    write('docs/readme.md', '# Docs')
    write('docs/draft.tmp', 'ignored by nested gitignore')
    write('node_modules/x/index.js', 'module.exports = 1')
    write('logo.png', 'png')
    try {
      symlinkSync('/etc', join(root, 'etc-link'))
    } catch {
      // symlinks may need privileges on Windows
    }
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('scans with ignores, block list and project detection', async () => {
    const result = await scanProject(root)
    const paths = result.files.map((f) => f.path)
    expect(result.scanMode).toBe('walk')
    expect(result.types).toEqual(['dotnet'])
    expect(paths).toEqual([
      '.env',
      '.env.example',
      '.gitignore',
      'docs/.gitignore',
      'docs/readme.md',
      'Shop.sln',
      'src/Api/Api.csproj',
      'src/Api/appsettings.json',
      'src/Api/Program.cs',
      'src/Api/Services/OrderService.cs'
    ])
    const env = result.files.find((f) => f.path === '.env')!
    expect(env.status).toBe('blocked')
    expect(result.files.find((f) => f.path === 'src/Api/appsettings.json')!.sensitive).toBe(true)
  })

  it('refuses paths outside the project', async () => {
    await expect(resolveInside(root, '../outside.txt')).rejects.toThrow()
    await expect(resolveInside(root, '/etc/passwd')).rejects.toThrow()
    await expect(resolveInside(root, 'src/../../x')).rejects.toThrow()
    await expect(resolveInside(root, 'etc-link/hosts')).rejects.toThrow()
    await expect(resolveInside(root, 'src/Api/Program.cs')).resolves.toContain('Program.cs')
  })

  it('composes a prompt with redaction, line ranges and warnings', async () => {
    const scan = await scanProject(root)
    const files = new Map<string, FileEntry>(scan.files.map((f) => [f.path, f]))
    const reader = new FileReader(root)
    const service = await reader.read('src/Api/Services/OrderService.cs')

    const out = await codeContextTool.buildDetailed({
      root,
      name: 'shop',
      types: scan.types,
      files,
      reader,
      selection: {
        'src/Api/appsettings.json': { mode: 'whole' },
        'src/Api/Services/OrderService.cs': { mode: 'ranges', ranges: [[3, 4]], hash: service.hash },
        'src/Api/Program.cs': { mode: 'ranges', ranges: [[1, 1]], hash: 'stale' },
        '.env': { mode: 'whole' }
      },
      treeMode: 'selected',
      wholeFileLineNumbers: false,
      allow: new Set()
    })

    const text = renderPrompt({ sections: [out.section], skill: null, task: 'Fix it', format: 'xml' })
    expect(text).not.toContain('Hunter2x')
    expect(text).not.toContain(AWS_KEY)
    expect(text).toContain('Password=[REDACTED:connection-string-password];')
    expect(text).toContain('<file path="src/Api/Services/OrderService.cs" lines="3-4" total_lines="5">')
    expect(text).toContain('3:   const string Key = "[REDACTED:aws-access-key]";\n4:   void Create() {}')
    expect(text).not.toContain('API_KEY=abc')
    expect(out.findings.map((f) => f.rule).sort()).toEqual(['aws-access-key', 'connection-string-password'])
    expect(out.warnings.map((w) => w.path).sort()).toEqual(['.env', 'src/Api/Program.cs'])

    // allowing a finding includes it, for that request only
    const allowed = await codeContextTool.buildDetailed({
      root,
      name: 'shop',
      types: scan.types,
      files,
      reader,
      selection: { 'src/Api/appsettings.json': { mode: 'whole' } },
      treeMode: 'none',
      wholeFileLineNumbers: false,
      allow: new Set(out.findings.filter((f) => f.rule === 'connection-string-password').map((f) => f.id))
    })
    expect(allowed.fileBlocks.get('src/Api/appsettings.json')).toContain('Hunter2x')
    expect(allowed.allowedCount).toBe(1)
  })

  it('ignores secrets outside the chosen lines', async () => {
    const scan = await scanProject(root)
    const reader = new FileReader(root)
    const service = await reader.read('src/Api/Services/OrderService.cs')
    const out = await codeContextTool.buildDetailed({
      root,
      name: 'shop',
      types: scan.types,
      files: new Map(scan.files.map((f) => [f.path, f])),
      reader,
      selection: { 'src/Api/Services/OrderService.cs': { mode: 'ranges', ranges: [[4, 5]], hash: service.hash } },
      treeMode: 'none',
      wholeFileLineNumbers: false,
      allow: new Set()
    })
    expect(out.findings).toEqual([])
  })
})
