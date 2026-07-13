// EXPERIMENT (local only, not for release): import a live Google web session
// from the user's real Chrome into an Electron partition, so Gmail loads
// authenticated without the embedded login Google blocks. Reads Chrome's
// cookie store (macOS `sqlite3` CLI), decrypts with the key from the login
// Keychain (`security` CLI) using Node's crypto — zero new dependencies.
// Never logs cookie VALUES. macOS + Google Chrome only.
//
// Validated by the spike (branch spike/chrome-cookie-import): the transplanted
// session loads Gmail logged in. Open question this experiment measures: how
// long the session survives (DBSC / server-side rotation).

import { Session } from 'electron'
import { execFileSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface ChromeProfile {
  name: string // "Default", "Profile 1"…
  dir: string
  mtimeMs: number // last time its cookies changed (proxy for "recently used")
}

function chromeRoot(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
}

// Profiles that have a cookie store, newest first. We never auto-pick in the
// experiment — the user chooses — but presenting newest-first is a good hint.
export function listChromeProfiles(): ChromeProfile[] {
  const root = chromeRoot()
  const out: ChromeProfile[] = []
  let entries: string[]
  try {
    entries = fs.readdirSync(root)
  } catch {
    return []
  }
  for (const entry of entries) {
    if (entry === 'System Profile' || entry === 'Guest Profile') continue
    try {
      const st = fs.statSync(path.join(root, entry, 'Cookies'))
      out.push({ name: entry, dir: path.join(root, entry), mtimeMs: st.mtimeMs })
    } catch {
      // no cookie store in this dir
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

// Chrome's cookie encryption key on macOS: PBKDF2 over a password kept in the
// login Keychain under "Chrome Safe Storage". Reading it triggers a one-time
// Keychain prompt (expected and honest — the user sees exactly what happens).
function safeStorageKey(): Buffer {
  const pw = execFileSync('/usr/bin/security', ['find-generic-password', '-ws', 'Chrome Safe Storage'], {
    encoding: 'utf8',
  }).trim()
  return crypto.pbkdf2Sync(pw, 'saltysalt', 1003, 16, 'sha1')
}

interface RawCookie {
  host: string
  name: string
  encHex: string
  path: string
  expires: string
  secure: string
  httpOnly: string
  sameSite: string
}

function readRawCookies(profileDir: string): RawCookie[] {
  const src = path.join(profileDir, 'Cookies')
  if (!fs.existsSync(src)) {
    throw new Error(`No cookie store at ${src}. Is this the right Chrome profile, signed in to Gmail?`)
  }
  // Copy the DB (and WAL sidecars) so a running Chrome's lock doesn't block us
  // and recent writes aren't missed. Cleaned up in `finally`.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtray-cookies-'))
  try {
    const dst = path.join(tmp, 'Cookies')
    fs.copyFileSync(src, dst)
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, dst + ext)
    }
    const sql =
      'SELECT host_key, name, hex(encrypted_value), path, expires_utc, is_secure, is_httponly, samesite ' +
      "FROM cookies WHERE host_key LIKE '%google.com'"
    const raw = execFileSync('/usr/bin/sqlite3', ['-tabs', dst, sql], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
    const rows: RawCookie[] = []
    for (const line of raw.split('\n')) {
      if (!line) continue
      const [host, name, encHex, p, expires, secure, httpOnly, sameSite] = line.split('\t')
      rows.push({ host, name, encHex, path: p, expires, secure, httpOnly, sameSite })
    }
    return rows
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function decryptValue(encHex: string, key: Buffer): string | null {
  const buf = Buffer.from(encHex, 'hex')
  if (buf.length === 0) return ''
  const prefix = buf.subarray(0, 3).toString('ascii')
  if (prefix !== 'v10' && prefix !== 'v11') return buf.toString('utf8') // stored unencrypted (rare)

  const iv = Buffer.alloc(16, 0x20) // 16 spaces
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)
  try {
    let out = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()])
    // Newer Chrome prepends a 32-byte SHA-256 of the domain to the plaintext.
    // A real cookie value is printable; a SHA-256 prefix is not — strip it.
    if (out.length >= 32 && !out.subarray(0, 32).every((b) => b >= 0x20 && b < 0x7f)) {
      out = out.subarray(32)
    }
    return out.toString('utf8')
  } catch {
    return null
  }
}

function toElectronCookie(r: RawCookie, value: string): Electron.CookiesSetDetails {
  const hostNoDot = r.host.replace(/^\./, '')
  const details: Electron.CookiesSetDetails = {
    url: `https://${hostNoDot}${r.path || '/'}`,
    name: r.name,
    value,
    domain: r.host,
    path: r.path || '/',
    secure: r.secure === '1',
    httpOnly: r.httpOnly === '1',
    sameSite: ({ '0': 'no_restriction', '1': 'lax', '2': 'strict' } as const)[r.sameSite] ?? 'unspecified',
  }
  const exp = Number(r.expires)
  // Chrome expires_utc: microseconds since 1601-01-01. 0 = session cookie.
  if (exp > 0) details.expirationDate = exp / 1_000_000 - 11644473600
  return details
}

export interface ImportResult {
  imported: number
  failed: string[] // cookie NAMES only (never values)
  earliestExpiry: number | null // Unix seconds of the soonest-expiring cookie
}

// Reads + decrypts the profile's Google cookies and writes them into `ses`.
// The caller is responsible for clearing `ses` first (clean destination).
export async function importGoogleCookies(profileDir: string, ses: Session): Promise<ImportResult> {
  const key = safeStorageKey()
  const raw = readRawCookies(profileDir)
  let imported = 0
  let earliestExpiry: number | null = null
  const failed: string[] = []
  for (const r of raw) {
    const value = decryptValue(r.encHex, key)
    if (value === null) {
      failed.push(`${r.name} (decrypt)`)
      continue
    }
    const details = toElectronCookie(r, value)
    try {
      await ses.cookies.set(details)
      imported++
      if (details.expirationDate && (earliestExpiry === null || details.expirationDate < earliestExpiry)) {
        earliestExpiry = details.expirationDate
      }
    } catch {
      failed.push(r.name)
    }
  }
  return { imported, failed, earliestExpiry }
}
