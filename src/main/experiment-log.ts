// Local, non-sensitive log for the browser-login experiment. Records only what
// we need to judge session durability over weeks: when a session was imported,
// how many app launches it survived, when it was last seen working, and when
// (if ever) it died. NEVER stores cookie values. Lives in userData and is
// easy to inspect or delete (File → Show Import Experiment Log).

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface AccountLog {
  email: string | null
  profile: string
  importedAt: string
  earliestExpiry: string | null // ISO, soonest cookie expiry at import time
  launches: number // app launches survived with the session still present
  lastSeenOk: string | null // last time the Atom feed authenticated
  diedAt: string | null // first time the feed reported an auth error
}

interface LogFile {
  accounts: Record<string, AccountLog>
}

function logPath(): string {
  return path.join(app.getPath('userData'), 'import-experiment.json')
}

function read(): LogFile {
  try {
    return JSON.parse(fs.readFileSync(logPath(), 'utf8')) as LogFile
  } catch {
    return { accounts: {} }
  }
}

function write(data: LogFile): void {
  fs.writeFileSync(logPath(), JSON.stringify(data, null, 2))
}

export function logImport(
  id: string,
  info: { email: string | null; profile: string; earliestExpiry: number | null },
): void {
  const data = read()
  data.accounts[id] = {
    email: info.email,
    profile: info.profile,
    importedAt: new Date().toISOString(),
    earliestExpiry: info.earliestExpiry ? new Date(info.earliestExpiry * 1000).toISOString() : null,
    launches: 0,
    lastSeenOk: null,
    diedAt: null,
  }
  write(data)
}

// Called once per app launch for each still-imported account.
export function logLaunch(id: string): void {
  const data = read()
  const a = data.accounts[id]
  if (!a) return
  a.launches++
  write(data)
}

// The Atom poller is our durability sensor: it authenticates every minute.
export function logAlive(id: string): void {
  const data = read()
  const a = data.accounts[id]
  if (!a) return
  a.lastSeenOk = new Date().toISOString()
  a.diedAt = null // a later success clears a transient blip
  write(data)
}

export function logDied(id: string): void {
  const data = read()
  const a = data.accounts[id]
  if (!a || a.diedAt) return // record only the first death
  a.diedAt = new Date().toISOString()
  write(data)
}

export function logRemove(id: string): void {
  const data = read()
  delete data.accounts[id]
  write(data)
}

// Human-readable summary for the "Show Import Experiment Log" menu item.
export function summaryText(): string {
  const data = read()
  const ids = Object.keys(data.accounts)
  if (ids.length === 0) return 'No imported sessions recorded yet.'
  return ids
    .map((id) => {
      const a = data.accounts[id]
      const since = Math.round((Date.now() - Date.parse(a.importedAt)) / 86_400_000)
      const status = a.diedAt ? `died ${a.diedAt.slice(0, 10)}` : 'alive'
      return (
        `• ${a.email ?? '(unknown)'} — from ${a.profile}\n` +
        `  imported ${a.importedAt.slice(0, 10)} (${since}d ago), ${a.launches} launches, ${status}` +
        (a.lastSeenOk ? `\n  last ok: ${a.lastSeenOk.slice(0, 16).replace('T', ' ')}` : '') +
        (a.earliestExpiry ? `\n  earliest cookie expiry: ${a.earliestExpiry.slice(0, 10)}` : '')
      )
    })
    .join('\n\n')
}
