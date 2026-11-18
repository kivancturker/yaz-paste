# yaz-paste

A desktop app (Windows + macOS) that turns your code into a clean, structured prompt for any AI chat.

Open a project folder, tick files (or pick specific lines), choose a skill, write the task, and copy one
XML or Markdown prompt to the clipboard. Secrets are redacted before anything reaches the clipboard.

## Use it

1. **Open a folder** (`Ctrl/⌘+O`). That folder is the project. You can also pass it on the command line:
   `yaz-paste C:\code\Shop`. The last project reopens automatically.
2. **Tick files** in the tree. Ticking a folder ticks everything under it. The filter box accepts text
   (`Order`) or globs (`src/**/*.cs`), and **Tick all shown** selects every match.
3. **Pick lines (optional)**: click a file to open it in the viewer, then any of:
   - **Selection strip** (left of the line numbers): drag to add a range. Each range shows as a bar; drag its
     round handles to move the first/last line, drag the bar to move it, and hover it for **×** to remove it
     (or double-click it). Shift-click extends the nearest range. Dragging near the top/bottom edge scrolls.
   - **Lines field** in the toolbar: type `10-25, 40` and press Enter.
   - **Line numbers**: click/drag to replace the selection, Shift-click to extend, Ctrl/⌘-click to add or remove.
   - **From text selection**: turns the text you selected in the editor into ranges.

   **Whole file** switches back to including all of it.
4. **Pick a preset** (or choose a skill and tick context files yourself) and **write the task**.
5. **Copy prompt** (`Ctrl/⌘+Shift+C`) or **Preview** (`Ctrl/⌘+Shift+P`).

The token count (≈, o200k tokenizer) and a bar against a 200k context window update as you go.

### What the prompt looks like

```xml
<project name="Shop" type="dotnet">
<directory_structure>
src/
  Shop.Api/
    Services/
      OrderService.cs  ← lines 7-15 (9 of 16)
    appsettings.json
</directory_structure>

<files>
<file path="src/Shop.Api/appsettings.json">
{ "ConnectionStrings": { "Default": "Server=dev-sql;Database=Shop;User Id=shop;Password=[REDACTED:connection-string-password];" } }
</file>
<file path="src/Shop.Api/Services/OrderService.cs" lines="7-15" total_lines="16">
 7:     public async Task<Order> CreateAsync(CreateOrder cmd)
 ...
</file>
</files>
</project>

<skill name="bug-fix">
…
</skill>

<task>
Creating an order with no items throws. Fix it.
</task>
```

Context comes first and the task last, which is the order models follow best. Ticked context files go in an
`<additional_context>` section between the project and the skill.

## Context files

Context files are saved reference files you can add to any prompt, separate from the project's code: coding
guidelines, architecture notes, example code, a glossary, "how to answer" instructions. Any text file works
(`.md`, `.txt`, `.cs`, `.ts`, `.json`…). Tick them in the **Context** list of the right panel.

Add files with **Context → Add file…** (they're copied into the library; the same block list and 1 MB limit as
project files apply, and they're secret-scanned on every copy), or drop files into the folders directly:

1. `<project>/.yaz/context/`: this project only; commit it to share with the team
2. `~/.yaz/context/` (Windows: `%USERPROFILE%\.yaz\context\`): all your projects
3. Built-in: `dotnet-conventions.md`, `node-conventions.md`, `review-checklist.md`, `answer-with-diffs.md`

Subfolders are fine. If two files have the same path, the first location in the list wins. A Markdown file can have
a `description:` in YAML frontmatter, which is shown in the list and left out of the prompt.

## Presets

A preset is a ready-made combination of a **skill**, **context files** and an optional **task template**, for the
cases you hit again and again. Choosing one sets the skill, ticks its context files, and fills the task box with the
template if it's empty. **Save as preset…** stores your current skill + context (and optionally the task) as a new
preset. Presets are Markdown files:

```markdown
---
name: .NET bug fix
description: Find and fix a bug in .NET code, answering with diffs
skill: bug-fix
context:
  - dotnet-conventions.md
  - answer-with-diffs.md
---
Bug:

Steps to reproduce:
```

They're loaded from `<project>/.yaz/presets/`, `~/.yaz/presets/`, and the built-in set: *.NET bug fix*,
*Node.js bug fix*, *Code review*, *.NET unit tests*, *EF Core model change*, *Security audit*,
*Explain to a newcomer*. The **⋯** menu opens the preset folders.

## Safety

| Layer | What it does |
|---|---|
| **Blocked files** | `.env*` (not `.env.example`), keys and certificates (`*.pem`, `*.pfx`, `*.snk`, `id_rsa`…), `secrets.json`, `*.pubxml`, `local.settings.json`, `.npmrc`, `.netrc`, `*.tfstate`, cloud credential JSON files, and `NuGet.Config` / `.yarnrc.yml` that contain credentials. These show a 🔒 and can't be ticked or opened. |
| **Ignored files** | `.gitignore` rules (via `git ls-files` when it's a git repo), plus defaults: `bin/`, `obj/`, `.vs/`, `node_modules/`, `dist/`, lockfiles, binaries and media. Add your own in a `.yazignore` file (gitignore syntax) at the project root. |
| **Sensitive files** | `appsettings*.json`, `web.config`, `launchSettings.json`, `docker-compose*.yml`… are allowed but marked 🛡. |
| **Secret scan** | Every included file is scanned before copying: connection-string passwords (SQL Server, Postgres, MySQL), credentials in URLs, Azure storage keys, AWS, GitHub, OpenAI, Anthropic, Stripe, Google, Slack, SendGrid, npm tokens, JWTs, private key blocks, and secret-looking assignments. Only the value is replaced (`Password=[REDACTED:…];`), so the AI still sees the structure. |
| **Review** | After copying, the panel lists each finding (with the secret masked). If one is a false positive, tick it and **Copy again**; that applies to that one copy only. |
| **Offline** | No network calls, no telemetry, no AI API. The UI has no file-system access; everything goes through a small, validated API in the main process. |

Files over 1 MB can't be included.

## Skills

Skills use the same `SKILL.md` format as Claude Code (one folder per skill, YAML frontmatter + Markdown body):

```markdown
---
name: bug-fix
description: Find the root cause, then propose a minimal fix as a diff
---
You are a senior engineer debugging this code. …
```

They are loaded from these folders. If two have the same `name`, the first one in this list wins:

1. `<project>/.claude/skills/`, `<project>/.agents/skills/`
2. `~/.claude/skills/`, `~/.agents/skills/` (Windows: `%USERPROFILE%\.claude\skills\`)
3. Built-in: `bug-fix`, `code-review`, `write-tests`, `refactor`, `explain-code`, `add-feature`,
   `ef-core-migration`, `security-review` (in [`skills/`](skills/))

## Develop

Requirements: Node.js 22+ and npm (plus Git). No native modules, so no Python or C++ build tools are needed.

```bash
npm install
```

```bash
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript checks for main and UI code |
| `npm run smoke` | Build, launch the real app on a fixture project, and check the clipboard end to end (screenshots in `.smoke/screens/`) |
| `npm run dist:win` | Windows installer (`release/*.exe`); run on Windows or CI |
| `npm run dist:mac` | macOS `.dmg` (universal); run on a Mac or CI |

`YAZ_USER_DATA=<folder>` runs the app with a separate profile.
`YAZ_EXECUTABLE=<app binary> node scripts/smoke.mjs` runs the smoke test against a packaged build.

### Layout

```
src/
  core/        prompt renderer, secret scanner, tokens, skills, context library & presets (no Electron imports)
  tools/code/  Tool #1: project scan, ignore/block rules, file reading, prompt section
  main/        Electron main process: window, menu, IPC, per-project state
  preload/     the typed bridge the UI calls (contextBridge)
  renderer/    React UI: file tree, Monaco viewer, composer
  shared/      types, line ranges, language map (used by both sides)
skills/        built-in skills
context/       built-in context files
presets/       built-in presets
tests/         unit tests
scripts/       smoke test
```

### Signing

Builds are unsigned by default. Without signing, Windows SmartScreen warns on first launch, and on macOS users
must allow the app once in *System Settings → Privacy & Security → Open Anyway*. To sign, add the certificates
(`CSC_LINK`, `CSC_KEY_PASSWORD`, and for macOS notarization `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)
as CI secrets and remove `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the workflow.

See [PLAN.md](PLAN.md) for the roadmap, including future tools such as the database schema tool.
