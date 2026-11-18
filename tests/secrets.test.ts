import { describe, expect, it } from 'vitest'
import { maskedLinePreview, redact, scanSecrets } from '../src/core/secrets'

// Fake credentials are assembled at runtime so this file never contains a real-looking secret literal.
const AWS_KEY = 'AKIA' + 'Q3EXAMPL7TESTKEY'
const GH_TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
const ANTHROPIC = 'sk-ant-' + 'api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const STRIPE = 'sk_live_' + '51HabcdefGHIJKLmnopQRSTuv'

function rules(text: string): string[] {
  return scanSecrets(text).map((f) => f.rule)
}

function redacted(text: string): string {
  return redact(text, scanSecrets(text))
}

describe('format rules', () => {
  it('finds well-known key formats', () => {
    expect(rules(`const key = "${AWS_KEY}";`)).toContain('aws-access-key')
    expect(rules(`token: ${GH_TOKEN}`)).toContain('github-token')
    expect(rules(`STRIPE=${STRIPE}`)).toContain('stripe-key')
  })

  it('reports an Anthropic key once, not also as an OpenAI key', () => {
    expect(rules(`ANTHROPIC_API_KEY=${ANTHROPIC}`)).toEqual(['anthropic-key'])
  })

  it('redacts a private key block and keeps the line count', () => {
    const pem = ['before', '-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA1', 'abcdef123456', '-----END RSA PRIVATE KEY-----', 'after'].join('\n')
    const out = redacted(pem)
    expect(out).not.toContain('MIIEowIBAAKCAQEA1')
    expect(out).toContain('[REDACTED:private-key]')
    expect(out.split('\n')).toHaveLength(pem.split('\n').length)
    expect(out.split('\n')[5]).toBe('after')
  })
})

describe('connection strings', () => {
  it('redacts only the password of a SQL Server connection string', () => {
    const line = `"Default": "Server=dev-sql;Database=Shop;User Id=app;Password=Hunter2!x;TrustServerCertificate=True"`
    const out = redacted(line)
    expect(out).toContain('Password=[REDACTED:connection-string-password];')
    expect(out).toContain('Server=dev-sql;Database=Shop;User Id=app;')
    expect(out).not.toContain('Hunter2')
  })

  it('handles Pwd= and web.config attributes', () => {
    const xml = `<add name="Db" connectionString="Data Source=.;Initial Catalog=Shop;Uid=sa;Pwd=S3cret!;" />`
    expect(redacted(xml)).toContain('Pwd=[REDACTED:connection-string-password];')
  })

  it('redacts credentials in URLs', () => {
    const out = redacted('DATABASE_URL=postgres://shop:pa55word@db.local:5432/shop')
    expect(out).toContain('postgres://shop:[REDACTED:url-credentials]@db.local')
  })

  it('redacts Azure storage account keys', () => {
    const conn = 'DefaultEndpointsProtocol=https;AccountName=shop;AccountKey=' + 'abcdEFGH1234ijklMNOP5678qrstUVWX9012yzAB==' + ';EndpointSuffix=core.windows.net'
    expect(rules(conn)).toContain('azure-storage-key')
  })
})

describe('context rules', () => {
  it('redacts quoted secrets next to secret-looking names', () => {
    expect(rules(`"ApiKey": "a8f5f167f44f4964e6c998dee827110c"`)).toContain('generic-secret')
    expect(rules(`private const string ClientSecret = @"Zx81-kd02-Lq99-Pp41";`)).toContain('generic-secret')
  })

  it('redacts uppercase env-style assignments', () => {
    expect(redacted('  - POSTGRES_PASSWORD=Sup3rS3cretValue')).toBe('  - POSTGRES_PASSWORD=[REDACTED:env-secret]')
  })

  it('leaves ordinary code alone', () => {
    const code = [
      'var password = request.Password;',
      'public async Task Run(CancellationToken cancellationToken)',
      '    cancellationToken: CancellationToken,',
      'const string TokenHeader = "X-Auth-Token";',
      'throw new Exception("Invalid password supplied");',
      'password: string;',
      'if (string.IsNullOrEmpty(user.PasswordHash)) return;'
    ].join('\n')
    expect(scanSecrets(code)).toEqual([])
  })

  it('skips placeholders', () => {
    const text = [
      '"ApiKey": "your-api-key-here"',
      'DB_PASSWORD=${DB_PASSWORD}',
      'Server=db;User Id=app;Password={0};',
      'API_TOKEN=<insert-token>',
      '"Password": "********"'
    ].join('\n')
    expect(scanSecrets(text)).toEqual([])
  })
})

describe('preview', () => {
  it('never shows the secret in the preview line', () => {
    const text = `line one\nconst key = "${AWS_KEY}"; // prod`
    const findings = scanSecrets(text)
    const preview = maskedLinePreview(text, findings, 2)
    expect(preview).toBe('const key = "[REDACTED:aws-access-key]"; // prod')
  })

  it('gives each finding a stable id hash, not the value', () => {
    const [f] = scanSecrets(`x = "${AWS_KEY}"`)
    expect(f.valueHash).toMatch(/^[0-9a-f]{12}$/)
    expect(f.valueHash).not.toContain('AKIA')
  })
})
