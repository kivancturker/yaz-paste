# yaz-paste — Plan

A desktop toolbox that builds prompts for AI chats. Each tool gathers one kind of context
(code, and later database schemas and more), and one shared composer turns it into a structured
XML prompt with your skills and task. It never puts secrets on the clipboard by accident.

**Tool #1 (build now): Code Context.** Open a folder, tick files (or selected lines), write what you want,
tick one or more skills, copy.

**Target environment:** Windows (most users) and macOS. The main projects are .NET, and Node.js projects are supported too.

## Status (2026-11-18)

**MVP is built** (see README.md for usage). Done: Electron shell with the security baseline; folder scan
(`git ls-files` or walk + nested `.gitignore`) with .NET/Node default ignores, `.yazignore`, block list and sensitive-file
markers; tri-state file tree with text/glob filter and "tick all shown"; Monaco viewer with line-range picking
(gutter click/drag, shift, ctrl/cmd, "use text selection", stale-range warning); XML and Markdown output; directory tree
modes; secret scan + redaction + review panel with allow-once; 8 built-in skills + project/user SKILL.md loading;
token estimate with a 200k meter; per-project state; recent projects; menu shortcuts; Windows/macOS packaging config;
unit tests and an end-to-end smoke test (passes on the dev build and on a packaged macOS app).

Added after the MVP: **context files** (saved reference files in `.yaz/context` / `~/.yaz/context` / built-in,
rendered as `<additional_context>`) and **presets** (skills + context + task template in `.yaz/presets` /
`~/.yaz/presets` / built-in), plus the line-selection rail and folder/file icons.

**Diff tool (built 2026-11-19)**: a second tool tab. Paste an AI answer, see its diffs side by side or inline, and copy the
full rebuilt files, so the AI only has to write diffs. See "Tool #2: Diff" below.

**Several skills per prompt (2026-11-19)**: skills are ticked like context files and rendered as one `<skill>` block
each, in the order ticked (reorderable). "What to do" skills (`bug-fix`) combine with "how to answer" skills (`diff-patch`).
Presets store `skills:` as a list (a single `skill:` is still read), and saved project state with one `skillId` is migrated.

Not yet verified: running on Windows (the CI workflow is written but not enabled: it's kept as `docs/ci-workflow.yml` until it's pushed with a login that has the `workflow` scope), signed installers.
Pulled forward from v1: glob filter + tick-all-shown, Markdown output, directory tree option.

---

## Prior art

| Tool | What it is | Worth borrowing |
|---|---|---|
| **PasteMax** | Open-source Electron app: file tree + checkboxes + copy | Closest to Tool #1 |
| **Repo Prompt** | macOS app, file tree, prompt templates | Saved prompts, token budget |
| **Repomix** | CLI that packs a repo into one XML/MD file | Output format, secret check |
| **code2prompt** | CLI with templates | Templating, token counting |

What sets yaz-paste apart: safety on by default, line-level selection, skills shared with agent tools,
several context tools in one app, and a .NET/Windows focus.

---

## Technical options

Hard requirements: works well on Windows, the team can build it with .NET tooling (no Rust toolchain),
full file-system access, clipboard, a good code viewer with line selection, and room for a future
DB tool that connects to SQL Server/Postgres.

| Option | Language | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Pure web app** (browser, File System Access API) | TS | Nothing to install | Chromium only, asks for folder permission every session, **can't connect to a DB**, can't read `~/.claude/skills` | ✗ Blocks the future tools |
| **B. Local web app** (ASP.NET Core on `localhost` + browser UI) | C# + TS/Blazor | Cross-platform, easy to debug, C# core | It's a local server: needs locking down (bind to 127.0.0.1, random token, CORS) or other websites could call it, which **matters a lot once it holds DB connection strings**. Feels less like an app | ◐ Viable |
| **C. Electron** | TS (Node) | Huge UI ecosystem, Monaco editor built in, what PasteMax uses | Core not in .NET; ~150 MB install; DB access through Node drivers | **★ Chosen** |
| **D. Native .NET desktop** (WPF / WinUI 3 / Avalonia) | C# + XAML | All C#, fast, small. AvalonEdit/AvaloniaEdit as code viewer; Avalonia also runs on Mac/Linux | Tree with tri-state checkboxes, line selection and a polished UI are more hand-work in XAML | ◐ Viable |
| **E. .NET host + web UI (Blazor Hybrid)** — WPF + `BlazorWebView` (or Photino.NET for cross-platform) | C# (+ a little JS for Monaco) | **C# everywhere** (core, UI logic, future DB drivers); web UI with Monaco; native dialogs/clipboard; no local server, so no open port; WebView2 is already on Win10/11; one `dotnet publish` | Monaco needs a JS-interop wrapper (BlazorMonaco exists); WPF host is Windows-only (MAUI Blazor Hybrid or Photino if Mac is ever needed, reusing the same components) | ◐ Viable |

**Decision: C — Electron + React + TypeScript.**

### Required tools
- **Node.js LTS + npm** (plus Git). That's all, **as long as we use no native npm modules** (see the rule below).
- Electron downloads its own Chromium during `npm install`. Behind a corporate proxy, set `ELECTRON_MIRROR` / the proxy env vars.
- **Rule: pure JS/WASM dependencies only.** Native modules (e.g. `keytar`, `better-sqlite3`, `node-pty`) would need
  Python + Visual Studio Build Tools (C++) + `@electron/rebuild` on every developer machine. Every library below avoids that.
- Day-to-day development works the same on Windows and macOS (`npm run dev`).

### Cross-platform (Windows + macOS)
One codebase. Electron runs on both, so the platform differences are only in packaging and a few details:

| Topic | Windows | macOS |
|---|---|---|
| Installer | NSIS `.exe` (electron-builder) | `.dmg` with a universal build (Apple Silicon + Intel) |
| Where to build it | Windows machine or CI `windows-latest` (from a Mac you'd need Wine) | **Must be built on a Mac**: a Mac machine or CI `macos-latest` |
| Signing | Optional code-signing cert; without one, SmartScreen warns on first launch | Apple Developer Program ($99/yr) to sign + notarize. Without it, users must allow the app in *System Settings → Privacy & Security → Open Anyway* |
| App data | `%APPDATA%\yaz-paste` | `~/Library/Application Support/yaz-paste` (always use `app.getPath('userData')`) |
| User skills | `%USERPROFILE%\.claude\skills` | `~/.claude/skills` (always use `os.homedir()`) |
| Secret storage (`safeStorage`) | DPAPI | Keychain |
| Shortcuts | Ctrl | Cmd (use Electron's `CommandOrControl` accelerator) |
| App menu | Window menu | macOS app menu (About / Quit / Edit for copy-paste to work) |

Rules in code: always use `path.join` / `path.relative`, never hard-coded `\` or `/`. Output paths are always `/`.
Don't assume the file system is case-insensitive (it's case-sensitive on Linux and on some Mac setups).
**CI runs a matrix of `windows-latest` + `macos-latest`** for tests and installers, so the release machine's OS doesn't matter.

### Key libraries
| Need | Library |
|---|---|
| Scaffolding / build | `electron-vite` (Vite + React + TS template), or Electron Forge with its Vite template |
| Code viewer + line selection | `monaco-editor` + `@monaco-editor/react` |
| File tree | `react-arborist` (virtualized; handles big repos) or a custom tree |
| `.gitignore` handling | `git ls-files --cached --others --exclude-standard` when git is available; fall back to the `ignore` package |
| Globs (`src/**/*.cs`) | `picomatch` / `fast-glob` |
| Token counting | `js-tiktoken` (pure JS, `o200k_base`; close enough for Claude/Gemini budgets) |
| Skill frontmatter | `yaml` (not `gray-matter`: it runs `---js` frontmatter as code, and project skills come from repos) |
| Clipboard | Electron built-in `clipboard` |
| Storing future DB secrets | Electron built-in `safeStorage` (DPAPI on Windows, Keychain on macOS), so no `keytar` |
| Future DB drivers | `mssql` (tedious, pure JS), `pg` |
| Tests | Vitest |
| Installer | `electron-builder` (NSIS for Windows, DMG for macOS) |

### Electron security baseline (non-negotiable)
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every window.
- The renderer (UI) has **no** file-system access. All file reads, scans, the secret scanner and the clipboard live in the **main process**.
  The UI calls them through a small typed API exposed by `preload` via `contextBridge`.
- The main process validates every IPC path: it must sit inside the opened project root, with no `..` escapes or symlinks pointing outside it.
- Strict CSP, no remote content loaded, and `will-navigate` / `setWindowOpenHandler` block external navigation.

### Project layout
```
yaz-paste/
  src/
    core/            # NO Electron imports: composer, XML renderer, secret scanner, tokens, skills loader
                     # (unit-testable; reusable later in a CLI)
    tools/
      code/          # Tool #1: project scan, ignore rules, file/line selection
      database/      # (future, placeholder only)
    main/            # Electron main process: windows, IPC handlers, dialogs, clipboard
    preload/         # contextBridge: typed API exposed to the UI
    renderer/        # React UI: shell, tool tabs, tree, Monaco viewer, composer
  tests/             # Vitest: secret scanner fixtures (fake keys), renderer snapshots
  skills/            # built-in skills (SKILL.md format)
```

---

## Architecture: multi-tool from day one

Every tool is a **context source** that produces context blocks. Everything after that is shared:

```
[Code tool]  ─┐
[DB tool]    ─┼─► ContextBlocks ─► Composer (skills + task) ─► Secret scan ─► XML render ─► Token count ─► Clipboard
[future...]  ─┘
```

```ts
export interface ContextBlock {
  tag: string;                         // "file", "table", ...
  attributes: Record<string, string>;  // path, lines, ...
  content: string;
}

export interface ContextTool {
  id: string;                          // "code", "database"
  displayName: string;
  build(signal: AbortSignal): Promise<ContextBlock[]>;
}
```

The UI is a shell with one tab per tool. All tools share the composer panel (skill, task, token count, copy).
You could later combine sources in one prompt, e.g. "these 3 files + the `Orders` table schema".

---

## Tool #1: Code Context

### Project
- Opening a folder defines a project. Its state is saved in `<userData>/projects/<hash>.json` (the app-data folder for each OS), **not** in the repo:
  selected files, line ranges, last task, skill.
- Detect the project type from markers (`*.sln`, `*.csproj`, `package.json`) and apply the matching default ignores.

### File tree
- Lazy-loaded, tri-state checkboxes (ticking a folder ticks its children), fuzzy filter, select by glob.
- Token count per file and in total.
- Locked files (see Safety) show a lock icon and can't be ticked.

### File viewer + line selection
- Clicking a file opens it read-only in Monaco with syntax highlighting (C#, TS/JS, JSON, XML, Razor, SQL, YAML).
- **Ticking a file selects the whole file by default.**
- In the viewer, select lines to switch that file into **ranges mode**: click/drag in the line-number gutter,
  shift-click to extend, ctrl-click to add another range. Selected lines are highlighted.
  The tree shows ranges files with a different icon and the line count, e.g. `UserService.cs  (L40–85, L120–140)`.
- "Select whole file" resets the file back to whole-file mode.
- Ranges are saved with a hash of the file content. If the file changes on disk, the ranges are flagged as
  "file changed, check your selection" instead of silently pointing at the wrong lines.

### .NET + Node specifics
- Default ignores. **OS clutter:** `.DS_Store`, `Thumbs.db`, `desktop.ini`. **IDE:** `.idea/`, `.vscode/` (optional). **.NET:** `bin/`, `obj/`, `.vs/`, `packages/`, `TestResults/`, `*.user`, `*.suo`, `*.dll`, `*.exe`, `*.pdb`, `*.nupkg`.
  **Node:** `node_modules/`, `dist/`, `build/`, `.next/`, `coverage/`; lockfiles are optional (off by default because they're huge).
- File details: output always uses `/` separators, whatever the OS.
  CRLF (common in Windows repos) is normalized to LF in the output (fewer tokens). UTF-8 BOM and UTF-16 files are decoded correctly. Long paths are supported.

### Output
```xml
<project name="Shop.Api" type="dotnet">
<directory_structure>
src/
  Shop.Api/
    Controllers/
      OrdersController.cs   ← included
    Services/
      OrderService.cs       ← lines 40-85
</directory_structure>

<files>
<file path="src/Shop.Api/Controllers/OrdersController.cs">
...whole file...
</file>
<file path="src/Shop.Api/Services/OrderService.cs" lines="40-85" total_lines="210">
40: public async Task<Order> CreateAsync(...)
...
</file>
</files>
</project>

<skill name="bug-fix">
...SKILL.md body...
</skill>

<task>
Creating an order with zero items returns 500. Fix it.
</task>
```
- Partial files include line numbers so the AI can cite them. Whole files don't by default (an option turns them on).
- The long context goes first and the task last, so the model reads the code before the instructions.
- Markdown output is an alternative format.

---

## Skills (same format agent tools use)

Use the **Agent Skills `SKILL.md` format** (the one Claude Code uses): one folder per skill, YAML frontmatter, Markdown body.

```
bug-fix/
  SKILL.md
  checklist.md        # optional extra files
```
```markdown
---
name: bug-fix
description: Find the root cause, then propose a minimal fix as a diff
---
You are a senior .NET engineer debugging this code.
1. Restate the bug in one sentence.
2. Find the root cause, citing file:line.
3. Propose the smallest fix as a unified diff.
Don't refactor unrelated code.
```

**Search locations** (all are merged; on a name clash, the more specific location wins):
1. Project: `<project>/.claude/skills/`, `<project>/.agents/skills/`
2. User: `~/.claude/skills/` (Windows: `%USERPROFILE%\.claude\skills\`)
3. Built-in: shipped with the app

This means skills you already wrote for Claude Code work here, and skills made in yaz-paste work in Claude Code.
The app pastes the frontmatter `name` + the body. Extra files in the skill folder are listed and can optionally be included.

**Built-in skills, ready to use:** `bug-fix`, `code-review`, `write-tests` (xUnit / Jest aware), `refactor`, `explain-code`,
`add-feature`, `ef-core-migration`, `security-review`, `diff-patch` (answers only with exact unified diffs for the Diff tool).

The app also includes a simple skill editor (create/edit/duplicate), and you choose where to save: project or user.

---

## Safety design (layered)

1. **Hard block list (by filename)**: these can't be ticked.
   - General: `.env*` (except `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.snk`, `*.jks`, `id_rsa*`, `id_ed25519*`, `.ssh/`, `.aws/`, `*.tfstate`, `kubeconfig`, `.git/`
   - .NET: `secrets.json`, `*.pubxml` / `*.pubxml.user` (publish profiles can hold passwords), `*.publishsettings`, `NuGet.Config` that contains `<packageSourceCredentials>`
   - Node: `.npmrc`, `.yarnrc.yml` that contains auth tokens
2. **Warn-and-scan files**: these can be included, but they are always scanned and highlighted:
   `appsettings*.json`, `web.config`, `app.config`, `launchSettings.json`, `docker-compose*.yml`.
3. **Content scan before copy**: regex rules (start from the gitleaks rule set), including:
   - **Connection strings**: `Password=…;` / `Pwd=…;` / `User ID=…;Password=…` (SQL Server), `postgres://user:pass@`, `mongodb+srv://user:pass@`, `AccountKey=` (Azure Storage), `SharedAccessKey=` (Service Bus)
   - Cloud/API keys: AWS `AKIA…`, Azure client secrets, GitHub `ghp_`/`github_pat_`, `sk-ant-`, `sk-`, Stripe `sk_live_`, Google `AIza…`, Slack `xox[bp]-`
   - Private key blocks, JWTs, high-entropy strings assigned to `secret|token|password|apikey|connectionstring`
4. **Redact, don't silently drop**: a match only replaces the value, e.g. `Password=[REDACTED];`, so the AI still sees the structure.
   A review panel shows "4 secrets redacted in 2 files", and you can allow one for this copy only.
5. **Offline by design**: no network calls, no telemetry, no AI API built in.
6. **Preview**: an optional preview of the exact clipboard text before copying.

---

## Phases

### MVP ✅ (built)
- Electron shell with one tab (Code Context), with the security baseline in place
- Open a folder, tree with checkboxes, .NET/Node default ignores + block list
- File viewer (Monaco, read-only) with **line-range selection**
- Load skills (project/user/built-in, SKILL.md) + 5 built-in skills
- Task box, XML renderer, copy to clipboard
- Secret scan + redaction + review panel
- Token counting
- Project state saved per folder

### v1
- Fuzzy filter, select by glob, saved selection presets ("Orders feature", "Auth")
- Skill editor
- Token budget against the target model
- Directory tree option: full project, or only the selected branches
- Markdown output option, keyboard shortcuts (Ctrl/Cmd+Shift+C = copy)
- File watcher (refresh tokens; flag changed ranges)
- Installers: Windows `.exe` (NSIS) + macOS `.dmg`, built by a CI matrix; signing/notarization when certificates are available

### v2 (Code tool)
- Git mode: changed files, or `git diff` instead of whole files
- Codemap: signatures only, via `web-tree-sitter` (WASM, so no native build; has C# and TS grammars), for unticked files
- Follow references: suggest files related to the selection (`using`/`import` graph, DI registrations)
- Apply back: paste the AI's reply, parse the diffs, review, apply → the review part is built as the Diff tool (below); writing to disk is next

---

## Tool #2: Diff (built)

The AI answers with unified diffs only (the built-in `diff-patch` skill asks for exactly the format the tool reads best:
verbatim context, excerpt line numbers stripped, 3+ lines of unique context; a test keeps its example parseable;
the shorter `answer-with-diffs` context file works with other skills); the app turns them back into
full files. That saves output tokens and avoids the AI writing the same code twice (and the two copies drifting apart).

- `src/tools/diff/parse.ts`: finds diffs in a pasted answer: Markdown fences (also indented in lists), raw `git diff`,
  `diff --git` extended headers (new/deleted/renamed/binary), hunks with or without line numbers, wrong hunk counts,
  blank context lines without their leading space, `\ No newline at end of file`, CRLF, Windows paths.
- `src/tools/diff/apply.ts`: strict applier. **A hunk is applied only where all of its context + removed lines are found.**
  Line numbers are only used to choose between identical blocks, and only when they point at one exactly.
  Tiers: exact → ignoring trailing whitespace → ignoring indentation (flagged). Context lines in the output always come
  from the file. Any hunk that can't be placed fails the whole file (no partial output). Detects already-applied changes.
- `src/tools/diff/resolve.ts`: diff path → project file (`a/`/`b/` prefixes, case, unique suffix), groups blocks per file.
- UI (`DiffTool.tsx`): paste box + file list with status, Monaco diff editor (side by side / inline, computed from the
  real old and new file), Full code view, Copy full file, explanations per change, and the raw hunks when a diff can't apply.
- Guarantee, checked by a fuzz test against real `git diff` output (including shifted and stripped line numbers):
  "Ready" is never wrong; anything uncertain is either flagged ("Check") or refused.

### Diff tool: next steps (it will grow)
- **Apply to disk**: write the rebuilt files into the project (with a confirmation listing the files; undo via a backup).
- **Resolve by hand**: when a hunk can't be placed or a block repeats, let the user pick the place in the file.
- **Copy all**: every rebuilt file in one go (as prompt-style `<file>` blocks or a zip).
- **Git mode**: show `git diff` of the working tree / a commit range in the same viewer (shares parse + view).
- **Full-file answers**: accept "here is the whole new file" blocks next to diffs and show them as a diff too.
- **Other formats**: `*** Begin Patch` style patches, search/replace blocks.
- **Send back**: when a diff can't apply, one click builds a follow-up prompt with the current file and the error.

## Future tools (planned, NOT implemented yet)

> Reminder only. Don't build these until Tool #1 ships. The `ContextTool` interface keeps room for them.

### Tool #2: Database Schema
- Input: a connection string for a **development** database (SQL Server first, then PostgreSQL, MySQL).
- It lists tables/views, and you tick the ones you want. Output per table: columns (name, type, nullable, default),
  primary key, foreign keys (→ relations), indexes, check constraints. Optionally: stored procedure/view definitions
  and row counts.
- Optional: N sample rows, **off by default**, with PII columns masked.
- XML output, e.g. `<database engine="sqlserver"><table name="dbo.Orders">…<foreign_key column="CustomerId" references="dbo.Customers.Id"/></table></database>`
- Safety:
  - Read-only queries against `INFORMATION_SCHEMA`/`sys.*` only, and the app recommends a read-only DB user.
  - **The connection string itself never goes into the output.**
  - Connection strings are stored encrypted (Electron `safeStorage`: DPAPI on Windows, Keychain on macOS), never in plain JSON.
  - A warning appears if the server name looks like production (`prod`, `live`, or a public IP).
- Could import EF Core `DbContext`/migrations as an alternative schema source (no live connection needed).

### Other tool ideas
- **Log / exception tool**: paste a stack trace, and it pulls in the referenced source lines automatically
- **API tool**: OpenAPI/Swagger spec → selected endpoints with their request/response schemas
- **Git tool**: a commit/PR range → diff + commit messages for review or release notes
- **Dependency tool**: `.csproj` / `package.json` package lists + versions (for upgrade questions)

---

## Open decisions

1. ~~Stack~~ → **Electron + React + TS** (decided)
2. Scaffolding: `electron-vite` or Electron Forge?
3. Secrets: redact automatically (recommended) or block the copy until reviewed?
4. Skill locations: is `.claude/skills` + `.agents/skills` right, or does the team use another agent tool?
5. App name / ignore-file name (`.yazignore`?)

## First milestones

1. Electron + Vite + React + TS skeleton with the security baseline, typed preload API and Vitest
2. Folder scan + ignore rules + block list → tree with checkboxes
3. Monaco viewer + line-range selection + persisted state
4. XML renderer + clipboard
5. Secret scanner + redaction + review panel (unit tests with fake keys and connection strings)
6. Skills loader + built-in skills + composer
7. Token counting
