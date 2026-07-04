import { app } from 'electron'

export interface BadgeAccount {
  id: string
  label: string
  unread: number
  authError: boolean
}

// Dock badge only, with the total unread count (no menu bar icon).
export function updateBadges(accounts: BadgeAccount[]): void {
  const total = accounts.reduce((sum, a) => sum + a.unread, 0)
  app.dock?.setBadge(total > 0 ? String(total) : '')
}
