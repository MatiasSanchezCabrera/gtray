import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

export interface Account {
  id: string
  email: string | null // null while the account is pending login
  name: string
  color: string
  photoUrl?: string | null // Gmail profile photo, extracted after login
}

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
}

export interface ConfigData {
  accounts: Account[]
  activeAccountId: string | null
  windowState: WindowState
  updateCheck: boolean // daily version check against gtray.app
  dismissedUpdateVersion: string | null // "Update available" closed for this version
}

const DEFAULTS: ConfigData = {
  accounts: [],
  activeAccountId: null,
  windowState: { width: 1280, height: 860 },
  updateCheck: true,
  dismissedUpdateVersion: null,
}

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

export function loadConfig(): ConfigData {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveConfig(data: ConfigData): void {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(data, null, 2))
}
