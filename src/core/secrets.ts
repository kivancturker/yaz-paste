import { createHash } from 'node:crypto'

/**
 * Secret scanner. Every rule marks only the secret *value* (capture group `group`), so redaction keeps
 * the surrounding structure, e.g. `Password=[REDACTED:connection-string-password];`.
 *
 * Rules are split in two kinds:
 *  - format rules (AKIA…, ghp_…, private key blocks): the format alone proves it's a credential, always redacted.
 *  - context rules (password=…, API_KEY=…): matched by the name next to the value, so they skip obvious
 *    placeholders and low-entropy values to avoid redacting ordinary code.
 */

export interface SecretRule {
  id: string
  regex: RegExp
  group: number
  /** Return false to ignore the match. `line` is the full source line around the match. */
  validate?: (value: string, line: string) => boolean
}

export interface SecretFinding {
  rule: string
  start: number
  end: number
  /** 1-based line of the start of the match. */
  line: number
  /** Short hash of the value, stable across copies; never the value itself. */
  valueHash: string
}

const PLACEHOLDER_HINTS = [
  'your', 'example', 'sample', 'placeholder', 'changeme', 'change_me', 'change-me', 'dummy', 'xxxx', '****',
  '<', '>', '${', '{{', '$(', '%(', '#{', 'process.env', 'environment.', 'configuration[', 'redacted', 'todo',
  'getenv', 'secret_here', 'insert'
]
const PLACEHOLDER_EXACT = new Set(['password', 'secret', 'token', 'pass', 'pwd', 'apikey', 'api_key', 'null', 'none', 'undefined', 'true', 'false'])

export function isPlaceholder(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v.length === 0) return true
  if (PLACEHOLDER_EXACT.has(v)) return true
  if (/^(.)\1+$/.test(v)) return true // "********", "xxxxxxxx"
  if (/^\{\d+\}$/.test(v) || /^%s$/.test(v)) return true // string.Format / printf slots
  return PLACEHOLDER_HINTS.some((hint) => v.includes(hint))
}

export function shannonEntropy(value: string): number {
  if (!value) return 0
  const counts = new Map<string, number>()
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let entropy = 0
  for (const count of counts.values()) {
    const p = count / value.length
    entropy -= p * Math.log2(p)
  }
  return entropy
}

/** Heuristic for values found next to a secret-looking name. */
function looksLikeSecretValue(value: string): boolean {
  if (isPlaceholder(value)) return false
  if (/\s/.test(value)) return false // messages like "Invalid password" are not secrets
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) return false // URLs/paths; URL creds have their own rule
  const hasDigit = /\d/.test(value)
  const entropy = shannonEntropy(value)
  if (value.length >= 20) return entropy >= 3.5
  return value.length >= 8 && hasDigit && entropy >= 2.5
}

const CONNECTION_STRING_KEYS = /(server|data source|host|user id|userid|uid|username|initial catalog|database|addr|address|port)\s*=/i

const SECRET_NAME = String.raw`[A-Za-z0-9_.\-]*?(?:secret|token|passw(?:or)?d|pwd|api[_\-]?key|access[_\-]?key|private[_\-]?key|auth[_\-]?key|client[_\-]?secret|credentials?)[A-Za-z0-9_.\-]*`

export const RULES: SecretRule[] = [
  {
    id: 'private-key',
    regex: /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----)([\s\S]*?)(-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----)/g,
    group: 2
  },
  { id: 'aws-access-key', regex: /\b((?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16})\b/g, group: 1 },
  {
    id: 'aws-secret-key',
    regex: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
    group: 1
  },
  { id: 'github-token', regex: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,})\b/g, group: 1 },
  { id: 'github-token', regex: /\b(github_pat_[A-Za-z0-9_]{22,})\b/g, group: 1 },
  { id: 'anthropic-key', regex: /\b(sk-ant-[A-Za-z0-9_\-]{20,})/g, group: 1 },
  { id: 'openai-key', regex: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{20,})/g, group: 1 },
  { id: 'stripe-key', regex: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b/g, group: 1 },
  { id: 'google-api-key', regex: /\b(AIza[0-9A-Za-z_\-]{35})(?![0-9A-Za-z_\-])/g, group: 1 },
  { id: 'slack-token', regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, group: 1 },
  { id: 'slack-webhook', regex: /(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_\-]+)/g, group: 1 },
  { id: 'sendgrid-key', regex: /\b(SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43})\b/g, group: 1 },
  { id: 'npm-token', regex: /\b(npm_[A-Za-z0-9]{36})\b/g, group: 1 },
  { id: 'azure-client-secret', regex: /(?<![A-Za-z0-9_~.\-])([A-Za-z0-9_~.\-]{3}\dQ~[A-Za-z0-9_~.\-]{31,34})(?![A-Za-z0-9_~.\-])/g, group: 1 },
  {
    id: 'azure-storage-key',
    regex: /(?:AccountKey|SharedAccessKey)\s*=\s*([A-Za-z0-9+/=]{20,})/g,
    group: 1
  },
  { id: 'jwt', regex: /\b(eyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,})/g, group: 1 },
  {
    // Server=db;User Id=app;Password=Hunter2;  (SQL Server, Postgres, MySQL, web.config, appsettings.json)
    id: 'connection-string-password',
    regex: /(?:^|[;"'\s{(,])(?:password|pwd)[ \t]*=[ \t]*([^;"'\r\n]+)/gi,
    group: 1,
    validate: (value, line) => CONNECTION_STRING_KEYS.test(line) && !isPlaceholder(value)
  },
  {
    // postgres://user:pass@host, mongodb+srv://user:pass@…, https://user:token@…
    id: 'url-credentials',
    regex: /\b[a-zA-Z][a-zA-Z0-9+.\-]*:\/\/[^\s:/@"'<>]+:([^\s@/"'<>]+)@/g,
    group: 1,
    validate: (value) => !isPlaceholder(value)
  },
  {
    // apiKey = "…", "Password": "…", const string ClientSecret = @"…"
    id: 'generic-secret',
    regex: new RegExp(String.raw`["']?(${SECRET_NAME})["']?\s*(?::=|=>|:|=)\s*@?["']([^"'\r\n]{8,})["']`, 'gi'),
    group: 2,
    validate: (value) => looksLikeSecretValue(value)
  },
  {
    // .env / docker-compose style:  DB_PASSWORD=s3cr3t-value   - API_KEY: abc123…
    id: 'env-secret',
    regex: /^[ \t]*(?:-[ \t]*)?(?:export[ \t]+)?([A-Z0-9_.]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CLIENT_?SECRET)[A-Z0-9_.]*)[ \t]*[=:][ \t]*([^\s"'#]{8,})[ \t]*$/gm,
    group: 2,
    validate: (value) => looksLikeSecretValue(value)
  }
]

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1)
  return starts
}

function lineIndexAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

/** Finds secrets in `text`. Overlapping matches are resolved in favour of the earliest, then longest. */
export function scanSecrets(text: string, rules: SecretRule[] = RULES): SecretFinding[] {
  const starts = lineStarts(text)
  const lineText = (idx: number): string => text.slice(starts[idx], idx + 1 < starts.length ? starts[idx + 1] - 1 : text.length)
  const raw: SecretFinding[] = []

  for (const rule of rules) {
    const re = new RegExp(rule.regex.source, rule.regex.flags.includes('d') ? rule.regex.flags : rule.regex.flags + 'd')
    for (const match of text.matchAll(re)) {
      const indices = match.indices?.[rule.group]
      const value = match[rule.group]
      if (!indices || value === undefined) continue
      let [start, end] = indices
      // trim whitespace around the value so `Password= abc ;` redacts just `abc`
      while (start < end && /\s/.test(text[start])) start++
      while (end > start && /\s/.test(text[end - 1])) end--
      if (end <= start) continue
      const trimmed = text.slice(start, end)
      const lineIdx = lineIndexAt(starts, start)
      if (rule.validate && !rule.validate(trimmed, lineText(lineIdx))) continue
      raw.push({ rule: rule.id, start, end, line: lineIdx + 1, valueHash: hashValue(trimmed) })
    }
  }

  raw.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
  const result: SecretFinding[] = []
  let lastEnd = -1
  for (const finding of raw) {
    if (finding.start < lastEnd) continue
    result.push(finding)
    lastEnd = finding.end
  }
  return result
}

export function redactionLabel(rule: string): string {
  return `[REDACTED:${rule}]`
}

/**
 * Replaces each finding (except the skipped ones) with a `[REDACTED:rule]` marker.
 * Line breaks inside a finding (e.g. a private key block) are kept, so line numbers don't shift.
 */
export function redact(text: string, findings: SecretFinding[], skip: (f: SecretFinding) => boolean = () => false): string {
  let out = ''
  let pos = 0
  for (const f of findings) {
    if (skip(f)) continue
    const newlines = text.slice(f.start, f.end).split('\n').length - 1
    out += text.slice(pos, f.start) + redactionLabel(f.rule) + '\n'.repeat(newlines)
    pos = f.end
  }
  return out + text.slice(pos)
}

/** The source line of a finding with every secret on that line masked, shortened for display. */
export function maskedLinePreview(text: string, findings: SecretFinding[], line: number, maxLength = 160): string {
  const starts = lineStarts(text)
  const idx = line - 1
  const lineStart = starts[idx]
  const lineEnd = idx + 1 < starts.length ? starts[idx + 1] - 1 : text.length
  let out = ''
  let pos = lineStart
  for (const f of findings) {
    if (f.end <= lineStart || f.start >= lineEnd) continue
    const s = Math.max(f.start, lineStart)
    out += text.slice(pos, s) + redactionLabel(f.rule)
    pos = Math.min(f.end, lineEnd)
  }
  out += text.slice(pos, lineEnd)
  out = out.trim()
  return out.length > maxLength ? out.slice(0, maxLength - 1) + '…' : out
}

export interface RedactedText {
  text: string
  findings: { id: string; path: string; line: number; rule: string; preview: string }[]
  allowedCount: number
}

/** Stable id of a finding: where it is, which rule, and a hash of the value (never the value). */
export function findingId(path: string, f: SecretFinding): string {
  return `${path}:${f.rule}:${f.valueHash}`
}

/**
 * Scans `content`, redacts every finding except the allowed ones, and describes the findings for the
 * review panel. `inScope` limits the scan to the part of the text that will actually be included.
 */
export function scanAndRedact(
  path: string,
  content: string,
  allow: Set<string>,
  inScope: (f: SecretFinding) => boolean = () => true
): RedactedText {
  const all = scanSecrets(content).filter(inScope)
  let allowedCount = 0
  const findings = all.map((f) => {
    const id = findingId(path, f)
    if (allow.has(id)) allowedCount++
    return { id, path, line: f.line, rule: f.rule, preview: maskedLinePreview(content, all, f.line) }
  })
  return { text: redact(content, all, (f) => allow.has(findingId(path, f))), findings, allowedCount }
}
