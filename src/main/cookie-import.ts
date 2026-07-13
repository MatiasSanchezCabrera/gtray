// SPIKE (throwaway): validate whether a Google web session logged in from the
// user's REAL Chrome can be transplanted into an Electron partition, so
// mail.google.com loads already authenticated — without the embedded login
// that Google blocks. If this holds (and survives DBSC), it is the basis for
// the real "log in via your browser" flow. Not wired into the app; run with
// `npm run spike`. macOS + Google Chrome only.
//
// Zero new dependencies: reads Chrome's cookie DB with the macOS `sqlite3`
// CLI, gets the decryption key from the login Keychain via `security`, and
// decrypts with Node's built-in crypto. Never logs cookie VALUES, only names.

import { BrowserWindow, session, Session } from 'electron'
import { execFileSync } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

function chromeProfileDir(): string {
  // Override with CHROME_PROFILE=Profile 1 etc. if the test account isn't in Default.
  const profile = process.env.CHROME_PROFILE || 'Default'
  return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', profile)
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

function readRawCookies(): RawCookie[] {
  const src = path.join(chromeProfileDir(), 'Cookies')
  if (!fs.existsSync(src)) {
    throw new Error(`Chrome cookies not found at ${src}. Is Chrome installed, and is the account in this profile?`)
  }
  // Copy the DB (and WAL sidecars) so a running Chrome's lock doesn't block us
  // and recent writes aren't missed.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtray-cookies-'))
  const dst = path.join(tmp, 'Cookies')
  fs.copyFileSync(src, dst)
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, dst + ext)
  }
  const sql =
    "SELECT host_key, name, hex(encrypted_value), path, expires_utc, is_secure, is_httponly, samesite " +
    "FROM cookies WHERE host_key LIKE '%google.com'"
  const out = execFileSync('/usr/bin/sqlite3', ['-tabs', dst, sql], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  fs.rmSync(tmp, { recursive: true, force: true })

  const rows: RawCookie[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [host, name, encHex, p, expires, secure, httpOnly, sameSite] = line.split('\t')
    rows.push({ host, name, encHex, path: p, expires, secure, httpOnly, sameSite })
  }
  return rows
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

async function importGoogleCookies(ses: Session): Promise<{ ok: number; failed: string[] }> {
  const key = safeStorageKey()
  const raw = readRawCookies()
  let ok = 0
  const failed: string[] = []
  for (const r of raw) {
    const value = decryptValue(r.encHex, key)
    if (value === null) {
      failed.push(`${r.name} (decrypt)`)
      continue
    }
    try {
      await ses.cookies.set(toElectronCookie(r, value))
      ok++
    } catch {
      failed.push(r.name)
    }
  }
  return { ok, failed }
}

export async function runCookieSpike(): Promise<void> {
  // Persistent partition so we can also relaunch and check the session HOLDS
  // over time (the DBSC question). Delete persist:cookie-spike to reset.
  const ses = session.fromPartition('persist:cookie-spike')
  // Mirror production: strip Chromium client hints on Google hosts (the global
  // Firefox UA from main.ts already applies process-wide).
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*.google.com/*'] }, (details, cb) => {
    const h = details.requestHeaders
    for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('sec-ch-')) delete h[k]
    cb({ requestHeaders: h })
  })

  console.log('[cookie-spike] harvesting Google cookies from Chrome…')
  const result = await importGoogleCookies(ses)
  console.log(`[cookie-spike] imported ${result.ok} cookies; ${result.failed.length} failed`)
  if (result.failed.length) console.log('[cookie-spike] failed names:', result.failed.join(', '))

  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'GTray cookie spike — is this logged in?',
    webPreferences: { session: ses },
  })
  await win.loadURL('https://mail.google.com/mail/u/0/')
  console.log('[cookie-spike] loaded mail.google.com/u/0 — check the window: logged in or a login screen?')
}
