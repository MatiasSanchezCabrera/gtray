// Update check: a plain GET to gtray.app/version.json (published by the
// release workflow on every tag), compared against app.getVersion(). No
// identifiers, no cookies — see the disclosure in the README. The user can
// turn the automatic check off from the app menu.

export const DMG_URL =
  'https://github.com/MatiasSanchezCabrera/gtray/releases/latest/download/GTray-arm64.dmg'
export const RELEASE_URL = 'https://github.com/MatiasSanchezCabrera/gtray/releases/latest'

// Overridable so the check can be tested against a local server in development
const VERSION_URL = process.env.GTRAY_UPDATE_URL ?? 'https://gtray.app/version.json'

export async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: unknown }
    return typeof data.version === 'string' ? data.version : null
  } catch {
    return null // offline or unreachable: silently try again next time
  }
}

export function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(Number)
  const b = current.split('.').map(Number)
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}
