// End-to-end smoke test: launches the built app on a fixture project, picks files and lines,
// copies the prompt and checks what landed on the clipboard. Run with `npm run smoke`.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = join(repo, '.smoke')
const fixture = join(work, 'ShopFixture')
const shots = join(work, 'screens')
// a fake home folder, so the test never touches the real ~/.yaz or ~/.claude/skills
const home = join(work, 'home')
rmSync(work, { recursive: true, force: true })
mkdirSync(shots, { recursive: true })

const AWS_KEY = 'AKIA' + 'Q3EXAMPL7TESTKEY'
const write = (rel, content) => {
  const full = join(fixture, rel)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}
write('Shop.sln', '')
write('src/Shop.Api/Shop.Api.csproj', '<Project Sdk="Microsoft.NET.Sdk.Web" />\n')
write('src/Shop.Api/Program.cs', 'var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.MapControllers();\napp.Run();\n')
write(
  'src/Shop.Api/appsettings.json',
  '{\n  "ConnectionStrings": {\n    "Default": "Server=dev-sql;Database=Shop;User Id=shop;Password=Hunter2x!;"\n  },\n  "Logging": { "LogLevel": { "Default": "Information" } }\n}\n'
)
write(
  'src/Shop.Api/Services/OrderService.cs',
  [
    'namespace Shop.Api.Services;',
    '',
    'public class OrderService(ShopDbContext db)',
    '{',
    `    private const string BackupKey = "${AWS_KEY}";`,
    '',
    '    public async Task<Order> CreateAsync(CreateOrder cmd)',
    '    {',
    '        var total = cmd.Items.Sum(i => i.Price * i.Quantity);',
    '        var average = total / cmd.Items.Count; // bug: divides by zero',
    '        var order = new Order { Total = total, Average = average };',
    '        db.Orders.Add(order);',
    '        await db.SaveChangesAsync();',
    '        return order;',
    '    }',
    '}'
  ].join('\n') + '\n'
)
write('.env', 'STRIPE_KEY=sk_live_x\n')
write('src/Shop.Api/bin/Debug/Shop.Api.dll', 'MZ')

// YAZ_EXECUTABLE=<path to a packaged app binary> tests a packaged build instead of the dev build
const executablePath = process.env.YAZ_EXECUTABLE
const app = await electron.launch({
  ...(executablePath ? { executablePath, args: [fixture] } : { args: [repo, fixture] }),
  env: { ...process.env, YAZ_USER_DATA: join(work, 'userdata'), YAZ_HOME: home, YAZ_NO_RESTORE: '1', YAZ_NO_TRASH: '1' }
})
const failures = []
const check = (ok, message) => {
  console.log(`${ok ? '✓' : '✗'} ${message}`)
  if (!ok) failures.push(message)
}

try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await page.waitForSelector('.tree .row', { timeout: 20_000 })
  check((await page.locator('.project-info strong').textContent()) === 'ShopFixture', 'opens the folder given on the command line')

  // expand folders
  for (const name of ['src', 'Shop.Api', 'Services']) await page.locator('.row.dir', { hasText: name }).first().click()
  const names = await page.locator('.tree .row .name').allTextContents()
  check(!names.includes('Shop.Api.dll') && !names.includes('bin'), 'hides bin/ build output')
  check((await page.locator('.row.file.locked', { hasText: '.env' }).count()) === 1, 'shows .env locked')
  check((await page.locator('.row.file.locked input[type=checkbox]').first().isDisabled()) === true, 'locked files cannot be ticked')

  // tick appsettings.json (whole file)
  await page.locator('.row.file', { hasText: 'appsettings.json' }).locator('input[type=checkbox]').check()

  // open OrderService.cs and drag over line numbers 7-15
  await page.locator('.row.file', { hasText: 'OrderService.cs' }).click()
  await page.waitForSelector('.monaco-editor .view-lines')
  await page.waitForTimeout(300)
  const lineNumber = (n) => page.locator('.monaco-editor .line-numbers', { hasText: new RegExp(`^\\s*${n}\\s*$`) }).first()
  const from = await lineNumber(7).boundingBox()
  const to = await lineNumber(15).boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  const status = () => page.locator('.viewer .status').textContent()
  check((await status()).includes('Lines 7-15'), 'line-number drag selects lines 7-15')
  check((await page.locator('.yaz-line-selected').count()) > 0, 'selected lines are highlighted')

  // selection rail: paint a new range, resize it with its handle, move it, remove it
  const rail = await page.locator('.rail').boundingBox()
  const railX = rail.x + rail.width / 2
  const lineY = async (n) => {
    const box = await lineNumber(n).boundingBox()
    return box.y + box.height / 2
  }
  const drag = async (fromY, toY) => {
    await page.mouse.move(railX, fromY)
    await page.mouse.down()
    await page.mouse.move(railX, toY, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(150)
  }
  await page.locator('.range-field input').fill('')
  await page.locator('.range-field input').press('Enter')
  await page.locator('.row.file', { hasText: 'OrderService.cs' }).locator('input[type=checkbox]').uncheck()
  await drag(await lineY(2), await lineY(4))
  check((await status()).includes('Lines 2-4'), 'dragging in the rail picks lines 2-4')
  check((await page.locator('.rail-range').count()) === 1, 'rail shows a bar for the range')
  const bottomHandle = await page.locator('.rail-handle.bottom').boundingBox()
  await page.mouse.move(bottomHandle.x + bottomHandle.width / 2, bottomHandle.y + bottomHandle.height / 2)
  await page.mouse.down()
  await page.mouse.move(railX, await lineY(6), { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  check((await status()).includes('Lines 2-6'), 'dragging the bottom handle resizes to 2-6')
  // grab the middle of the 2-6 bar (line 4) and drop it on line 12
  await drag(await lineY(4), await lineY(12))
  check((await status()).includes('Lines 10-14'), 'dragging the bar moves the range to 10-14')
  await drag(await lineY(2), await lineY(3))
  check((await status()).includes('Lines 2-3, 10-14'), 'a second rail drag adds another range')
  await page.locator('.rail-range').first().hover()
  await page.locator('.rail-remove').first().click()
  await page.waitForTimeout(150)
  check((await status()).includes('Lines 10-14') && !(await status()).includes('2-3'), '× removes a range')
  await page.screenshot({ path: join(shots, '0-rail.png') })

  // typed ranges
  await page.locator('.range-field input').fill('abc')
  await page.locator('.range-field input').press('Enter')
  check((await page.locator('.range-field.invalid').count()) === 1, 'invalid typed ranges are flagged')
  await page.locator('.range-field input').fill('7-15')
  await page.locator('.range-field input').press('Enter')
  check((await status()).includes('Lines 7-15'), 'typing 7-15 selects those lines')

  // preset: applies a skill + context files + task template
  await page.locator('#preset').selectOption('.NET bug fix')
  await page.waitForTimeout(200)
  check((await page.locator('#skill').inputValue()) === 'bug-fix', 'preset sets the skill')
  const tickedContext = await page.locator('.context-list li label.on .context-name').allTextContents()
  check(
    tickedContext.length === 2 && tickedContext.includes('dotnet-conventions.md') && tickedContext.includes('answer-with-diffs.md'),
    `preset ticks its context files (${tickedContext.join(', ')})`
  )
  check((await page.locator('#task').inputValue()).includes('Steps to reproduce'), 'preset fills the empty task with its template')
  await page.locator('#task').fill('Creating an order with no items throws. Fix it.')

  // save the current setup as a project preset, then delete it
  page.on('dialog', (d) => void d.accept())
  await page.locator('.composer button', { hasText: 'Save current…' }).click()
  await page.locator('.small-modal input').first().fill('Smoke preset')
  await page.locator('.small-modal label', { hasText: 'This project' }).locator('input').check()
  await page.locator('.small-modal button[type=submit]').click()
  await page.waitForTimeout(400)
  const presetFile = join(fixture, '.yaz', 'presets', 'smoke-preset.md')
  check(existsSync(presetFile) && readFileSync(presetFile, 'utf8').includes('dotnet-conventions.md'), 'Save as preset writes .yaz/presets/smoke-preset.md')
  check((await page.locator('#preset').inputValue()) === 'Smoke preset', 'the saved preset is selected')
  await page.locator('.composer button', { hasText: 'Edit' }).first().click()
  await page.waitForSelector('.library-modal')
  check((await page.locator('.library-editor input').first().inputValue()) === 'Smoke preset', 'Edit opens the preset in the library')
  await page.locator('.library-modal button.danger-outline', { hasText: 'Delete' }).click()
  await page.waitForTimeout(400)
  check(!existsSync(presetFile), 'Delete removes the preset file')
  await page.locator('.library-modal .modal-head button', { hasText: 'Close' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(shots, '1-workspace.png') })

  // copy
  await page.locator('button.primary', { hasText: 'Copy prompt' }).click()
  await page.waitForSelector('.review')
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
  writeFileSync(join(work, 'clipboard.txt'), clip)
  check(clip.startsWith('<project name="ShopFixture" type="dotnet">'), 'prompt starts with the project section')
  check(clip.includes('<file path="src/Shop.Api/Services/OrderService.cs" lines="7-15" total_lines="16">'), 'line range is in the prompt')
  check(clip.includes(' 9:         var total') && !clip.includes('BackupKey'), 'only the chosen lines are included')
  check(clip.includes('Password=[REDACTED:connection-string-password];') && !clip.includes('Hunter2x'), 'connection string password redacted')
  check(!clip.includes('sk_live_x'), '.env never included')
  check(clip.includes('<skill name="bug-fix">') && clip.trimEnd().endsWith('</task>'), 'skill and task come last')
  const order = ['</project>', '<additional_context>', '<document name="dotnet-conventions.md">', '<skill name=', '<task>'].map((t) => clip.indexOf(t))
  check(order.every((pos, i) => pos >= 0 && (i === 0 || pos > order[i - 1])), 'order: project, additional context, skill, task')
  check((await page.locator('.findings li').count()) === 1, 'review panel lists the redacted secret')
  await page.screenshot({ path: join(shots, '2-copied.png') })

  // allow once, copy again
  await page.locator('.findings li input[type=checkbox]').check()
  await page.locator('button.danger').click()
  await page.waitForTimeout(400)
  const clip2 = await app.evaluate(({ clipboard }) => clipboard.readText())
  check(clip2.includes('Hunter2x'), 'allowed secret is included on the next copy')
  await page.locator('button.primary', { hasText: 'Copy prompt' }).click()
  await page.waitForTimeout(400)
  const clip3 = await app.evaluate(({ clipboard }) => clipboard.readText())
  check(!clip3.includes('Hunter2x'), 'allow lasts for one copy only')

  // preview
  await page.locator('button', { hasText: 'Preview' }).click()
  await page.waitForSelector('.modal')
  await page.screenshot({ path: join(shots, '3-preview.png') })
  await page.keyboard.press('Escape')

  // markdown
  await page.locator('.segmented button', { hasText: 'Markdown' }).click()
  await page.locator('button.primary', { hasText: 'Copy prompt' }).click()
  await page.waitForTimeout(400)
  const md = await app.evaluate(({ clipboard }) => clipboard.readText())
  check(md.startsWith('# Project: ShopFixture') && md.includes('```csharp'), 'markdown format works')

  // ---- resizable panels ----
  const treeWidth = async () => (await page.locator('.tree-panel').boundingBox()).width
  const before = await treeWidth()
  const splitter = await page.locator('.splitter').first().boundingBox()
  await page.mouse.move(splitter.x + splitter.width / 2, splitter.y + 200)
  await page.mouse.down()
  await page.mouse.move(splitter.x + splitter.width / 2 + 120, splitter.y + 200, { steps: 6 })
  await page.mouse.up()
  check(Math.abs((await treeWidth()) - before - 120) <= 2, `dragging the splitter widens the file tree (${before} → ${await treeWidth()})`)
  await page.locator('.splitter').first().dblclick()
  check(Math.abs((await treeWidth()) - 300) <= 2, 'double-clicking the splitter resets the width')
  const composerBefore = (await page.locator('.composer').boundingBox()).width
  const right = await page.locator('.splitter').nth(1).boundingBox()
  await page.mouse.move(right.x + right.width / 2, right.y + 200)
  await page.mouse.down()
  await page.mouse.move(right.x + right.width / 2 - 100, right.y + 200, { steps: 6 })
  await page.mouse.up()
  check(Math.abs((await page.locator('.composer').boundingBox()).width - composerBefore - 100) <= 2, 'dragging the right splitter widens the prompt panel')

  // ---- library: create a context file, a skill and a preset from inside the app ----
  await page.locator('.segmented button', { hasText: 'XML' }).click()
  const section = (label) => page.locator('.composer section', { has: page.locator('.label', { hasText: new RegExp(`^${label}`) }) })
  const field = (label) => page.locator('.library-editor .field', { has: page.locator('.label', { hasText: label }) }).locator('input, textarea, select').first()

  await section('Context').locator('button', { hasText: 'New' }).click()
  await page.waitForSelector('.library-modal')
  await field('File name').fill('team-rules')
  await field('Description').fill('Our team rules')
  await field('Content').fill('Always use records for DTOs.')
  await page.locator('.library-modal button.primary', { hasText: 'Create context file' }).click()
  await page.waitForTimeout(400)
  const ctxFile = join(home, '.yaz', 'context', 'team-rules.md')
  check(existsSync(ctxFile) && readFileSync(ctxFile, 'utf8').includes('description: Our team rules'), 'New context file is written to ~/.yaz/context')
  await page.screenshot({ path: join(shots, '5-library-context.png') })
  await page.locator('.library-modal button', { hasText: 'Tick for this prompt' }).click()
  await page.waitForTimeout(200)
  check((await page.locator('.context-list li label.on .context-name', { hasText: 'team-rules.md' }).count()) === 1, '"Tick for this prompt" ticks the new context file')

  await section('Skill').locator('button', { hasText: 'New' }).click()
  await page.waitForSelector('.library-modal')
  await field('Name').fill('smoke-skill')
  await field('Description').fill('A skill made by the smoke test')
  await field('Instructions').fill('Answer in one sentence.')
  await page.locator('.library-modal button.primary', { hasText: 'Create skill' }).click()
  await page.waitForTimeout(400)
  const skillFile = join(home, '.claude', 'skills', 'smoke-skill', 'SKILL.md')
  check(existsSync(skillFile) && readFileSync(skillFile, 'utf8').includes('Answer in one sentence.'), 'New skill is written to ~/.claude/skills/smoke-skill/SKILL.md')
  await page.locator('.library-modal button', { hasText: 'Use this skill' }).click()
  await page.waitForTimeout(200)
  check((await page.locator('#skill').inputValue()) === 'smoke-skill', '"Use this skill" selects it')

  await section('Preset').locator('button', { hasText: 'New' }).click()
  await page.waitForSelector('.library-modal')
  await page.waitForTimeout(200)
  check((await field('Skill').inputValue()) === 'smoke-skill', 'a new preset starts from the current skill')
  await field('Name').fill('Smoke combo')
  await field('Task template').fill('Explain:')
  await page.locator('.library-modal button.primary', { hasText: 'Create preset' }).click()
  await page.waitForTimeout(400)
  const comboFile = join(home, '.yaz', 'presets', 'smoke-combo.md')
  const combo = existsSync(comboFile) ? readFileSync(comboFile, 'utf8') : ''
  check(combo.includes('skill: smoke-skill') && combo.includes('team-rules.md') && combo.includes('Explain:'), 'New preset saves skill, context and task template')
  await page.screenshot({ path: join(shots, '6-library-preset.png') })
  await page.locator('.library-modal button', { hasText: 'Apply preset' }).click()
  await page.waitForTimeout(200)
  check((await page.locator('#preset').inputValue()) === 'Smoke combo', '"Apply preset" selects it')

  // built-in skills are read-only; duplicating makes an editable copy that overrides them
  await page.locator('.topbar button', { hasText: 'Library' }).click()
  await page.locator('.library-modal .tabs button', { hasText: 'Skills' }).click()
  await page.locator('.library-list li', { hasText: 'bug-fix' }).click()
  await page.waitForTimeout(300)
  check((await page.locator('.library-editor .banner').count()) === 1 && (await field('Instructions').isDisabled()), 'built-in skill opens read-only')
  await page.screenshot({ path: join(shots, '7-library-builtin.png') })
  await page.locator('.banner button', { hasText: 'Duplicate to edit' }).click()
  await field('Description').fill('My own bug-fix')
  await page.locator('.library-modal button.primary', { hasText: 'Create skill' }).click()
  await page.waitForTimeout(400)
  check(existsSync(join(home, '.claude', 'skills', 'bug-fix', 'SKILL.md')), 'duplicate writes ~/.claude/skills/bug-fix')
  check((await page.locator('.library-list li', { hasText: 'bug-fix' }).locator('.source').textContent()) === 'Yours', 'your copy replaces the built-in bug-fix')

  // edit then delete the new skill
  await page.locator('.library-list li', { hasText: 'smoke-skill' }).click()
  await page.waitForTimeout(300)
  await field('Description').fill('Edited description')
  await page.locator('.library-modal button.primary', { hasText: 'Save changes' }).click()
  await page.waitForTimeout(400)
  check(readFileSync(skillFile, 'utf8').includes('Edited description'), 'Save changes updates SKILL.md')
  await page.locator('.library-modal button.danger-outline', { hasText: 'Delete' }).click()
  await page.waitForTimeout(400)
  check(!existsSync(join(home, '.claude', 'skills', 'smoke-skill')), 'Delete removes the skill folder')
  await page.locator('.library-modal .modal-head button', { hasText: 'Close' }).click()

  // dark mode
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, '4-dark.png') })
  check(errors.length === 0, `no renderer errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await app.close()
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll smoke checks passed')
process.exit(failures.length ? 1 : 0)
