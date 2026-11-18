import picomatch from 'picomatch'
import type { ProjectType } from '../../shared/types'

/** Files larger than this can't be included (or opened in the viewer). */
export const MAX_FILE_BYTES = 1024 * 1024
/** The scan stops after this many files. */
export const MAX_FILES = 50_000

/** Ignored everywhere (gitignore syntax). */
export const COMMON_IGNORES = [
  '.git/',
  '.hg/',
  '.svn/',
  'node_modules/',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.idea/',
  '.vs/',
  'coverage/',
  '*.log',
  // lockfiles: huge and rarely useful in a prompt
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'packages.lock.json',
  // binaries and media
  '*.{png,jpg,jpeg,gif,bmp,ico,icns,webp,tif,tiff,psd,ai,sketch,fig}',
  '*.{woff,woff2,ttf,otf,eot}',
  '*.{zip,tar,gz,tgz,bz2,xz,7z,rar}',
  '*.{dll,exe,pdb,so,dylib,a,lib,o,obj,class,jar,war,nupkg,snupkg,msi,msix,appx,dmg,pkg,deb,rpm}',
  '*.{mp3,mp4,m4a,mov,avi,mkv,wav,ogg,flac,webm}',
  '*.{pdf,doc,docx,xls,xlsx,ppt,pptx,odt,ods}',
  '*.{sqlite,sqlite3,db,mdf,ldf,bak}',
  '*.{bin,dat,wasm,node}'
]

export const DOTNET_IGNORES = ['bin/', 'obj/', 'packages/', 'TestResults/', '*.user', '*.suo', '*.cache', '_ReSharper*/', '*.DotSettings.user']

export const NODE_IGNORES = ['dist/', 'build/', '.next/', '.nuxt/', '.output/', '.turbo/', '.cache/', '.parcel-cache/', '.svelte-kit/', '.angular/', '*.min.js', '*.min.css', '*.map', '*.tsbuildinfo']

/** gitignore syntax has no `{a,b}` braces, so expand them: `*.{png,jpg}` → `*.png`, `*.jpg`. */
export function expandBraces(pattern: string): string[] {
  const m = /\{([^{}]+)\}/.exec(pattern)
  if (!m) return [pattern]
  return m[1].split(',').flatMap((alt) => expandBraces(pattern.slice(0, m.index) + alt + pattern.slice(m.index + m[0].length)))
}

export function defaultIgnores(types: ProjectType[]): string[] {
  return [...COMMON_IGNORES, ...(types.includes('dotnet') ? DOTNET_IGNORES : []), ...(types.includes('node') ? NODE_IGNORES : [])].flatMap(
    expandBraces
  )
}

interface BlockRule {
  reason: string
  patterns: string[]
  except?: string[]
}

/** Files that can never be ticked or opened, whatever their content. */
export const BLOCK_RULES: BlockRule[] = [
  {
    reason: 'Environment file (.env) — usually holds secrets',
    patterns: ['**/.env', '**/.env.*', '**/*.env'],
    except: ['**/.env.example', '**/.env.sample', '**/.env.template', '**/.env.dist', '**/.env.defaults']
  },
  {
    reason: 'Private key or certificate store',
    patterns: ['**/*.{pem,key,p12,pfx,snk,jks,keystore,p8,ppk,asc,gpg}', '**/id_{rsa,dsa,ecdsa,ed25519}*']
  },
  {
    reason: 'Credentials folder',
    patterns: ['**/.ssh/**', '**/.aws/**', '**/.azure/**', '**/.kube/**', '**/.gnupg/**', '**/.docker/config.json']
  },
  {
    reason: 'Infrastructure state or kubeconfig',
    patterns: ['**/*.tfstate', '**/*.tfstate.*', '**/*.tfvars', '**/kubeconfig', '**/*.kubeconfig']
  },
  {
    reason: '.NET secrets or publish profile (can contain passwords)',
    patterns: ['**/secrets.json', '**/*.pubxml', '**/*.pubxml.user', '**/*.publishsettings', '**/local.settings.json']
  },
  {
    reason: 'Package manager or auth config (can contain tokens)',
    patterns: ['**/.npmrc', '**/.yarnrc', '**/.pypirc', '**/.netrc', '**/_netrc', '**/.git-credentials', '**/.htpasswd', '**/.pgpass']
  },
  {
    reason: 'Cloud credentials file',
    patterns: ['**/credentials*.json', '**/service-account*.json', '**/serviceaccount*.json', '**/client_secret*.json', '**/*-credentials.json']
  }
]

/** Config files that often hold secrets: allowed, but marked and always scanned. */
export const SENSITIVE_PATTERNS = [
  '**/appsettings*.json',
  '**/web*.config',
  '**/app.config',
  '**/launchSettings.json',
  '**/docker-compose*.{yml,yaml}',
  '**/compose*.{yml,yaml}',
  '**/.env.*',
  '**/*.settings.json',
  '**/config/*.{json,yml,yaml}'
]

/** Files blocked only when their content holds credentials (checked during the scan). */
export const CONTENT_BLOCKS: { pattern: string; test: RegExp; reason: string }[] = [
  { pattern: '**/nuget.config', test: /<packageSourceCredentials>/i, reason: 'NuGet.Config with package source credentials' },
  { pattern: '**/.yarnrc.yml', test: /npmAuthToken|npmAuthIdent/i, reason: '.yarnrc.yml with an auth token' }
]

const opts = { dot: true, nocase: true }
const compiled = BLOCK_RULES.map((rule) => ({
  reason: rule.reason,
  match: picomatch(rule.patterns, opts),
  except: rule.except ? picomatch(rule.except, opts) : () => false
}))
const sensitiveMatch = picomatch(SENSITIVE_PATTERNS, opts)
const contentBlocks = CONTENT_BLOCKS.map((c) => ({ ...c, match: picomatch(c.pattern, opts) }))

/** Returns why the path is blocked, or null. `path` is project-relative with `/` separators. */
export function blockReason(path: string): string | null {
  for (const rule of compiled) if (rule.match(path) && !rule.except(path)) return rule.reason
  return null
}

export function isSensitive(path: string): boolean {
  return sensitiveMatch(path)
}

/** The content checks that apply to `path`, if any. */
export function contentBlockFor(path: string): { test: RegExp; reason: string } | null {
  return contentBlocks.find((c) => c.match(path)) ?? null
}
