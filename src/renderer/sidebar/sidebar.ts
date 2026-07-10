interface AccountState {
  id: string
  name: string
  email: string | null
  color: string
  photoUrl: string | null
  unread: number
  authError: boolean
  active: boolean
  pending: boolean
}

interface TrayApi {
  onState: (
    callback: (state: { accounts: AccountState[]; update: { version: string } | null }) => void,
  ) => void
  select: (id: string) => void
  add: () => void
  accountMenu: (id: string) => void
  accountTooltip: (payload: { text: string; y: number } | null) => void
  donate: () => void
  openApp: (app: 'calendar' | 'meet' | 'drive') => void
  updateOpen: () => void
  updateDismiss: () => void
}

declare global {
  interface Window {
    tray: TrayApi
  }
}

const accountsEl = document.getElementById('accounts') as HTMLElement
const titleEl = document.getElementById('active-title') as HTMLElement
const emptyEl = document.getElementById('empty-state') as HTMLElement
const addEl = document.getElementById('add') as HTMLElement

addEl.addEventListener('click', () => window.tray.add())

const donateEl = document.getElementById('donate') as HTMLElement
donateEl.addEventListener('click', () => window.tray.donate())

const calendarEl = document.getElementById('open-calendar') as HTMLElement
const meetEl = document.getElementById('open-meet') as HTMLElement
const driveEl = document.getElementById('open-drive') as HTMLElement
calendarEl.addEventListener('click', () => window.tray.openApp('calendar'))
meetEl.addEventListener('click', () => window.tray.openApp('meet'))
driveEl.addEventListener('click', () => window.tray.openApp('drive'))

const updateEl = document.getElementById('update') as HTMLElement
const updateGoEl = document.getElementById('update-go') as HTMLElement
const updateCloseEl = document.getElementById('update-close') as HTMLElement
updateGoEl.addEventListener('click', () => window.tray.updateOpen())
updateCloseEl.addEventListener('click', () => window.tray.updateDismiss())

window.tray.onState((state) => {
  updateEl.classList.toggle('hidden', !state.update)
  if (state.update) {
    updateGoEl.textContent = `Update to ${state.update.version}`
    updateGoEl.title = `GTray ${state.update.version} is available — download or see the release notes`
  }

  accountsEl.textContent = ''
  for (const account of state.accounts) {
    const button = document.createElement('button')
    button.className = 'avatar' + (account.active ? ' active' : '')
    button.style.setProperty('--color', account.color)

    const initial = (account.email ?? account.name).charAt(0).toUpperCase()
    button.textContent = initial
    if (account.photoUrl) {
      const img = document.createElement('img')
      img.className = 'avatar-img'
      img.src = account.photoUrl
      img.referrerPolicy = 'no-referrer'
      // If the photo fails to load, the initial underneath stays visible
      img.addEventListener('error', () => img.remove())
      button.appendChild(img)
    }

    if (account.authError) {
      const warn = document.createElement('span')
      warn.className = 'warn'
      warn.title = 'Session expired: click to sign in again'
      button.appendChild(warn)
    } else if (account.unread > 0) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = account.unread > 99 ? '99+' : String(account.unread)
      button.appendChild(badge)
    }

    button.addEventListener('click', () => window.tray.select(account.id))
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      window.tray.accountMenu(account.id)
    })
    // Instant identification on hover: a native floating tooltip next to the
    // avatar (a DOM tooltip would be covered by the Gmail view, and the
    // built-in title one is too slow)
    button.addEventListener('mouseenter', () => {
      const rect = button.getBoundingClientRect()
      window.tray.accountTooltip({
        text: account.email ?? account.name,
        y: rect.top + rect.height / 2,
      })
    })
    button.addEventListener('mouseleave', () => window.tray.accountTooltip(null))
    accountsEl.appendChild(button)
  }

  const active = state.accounts.find((a) => a.active)
  titleEl.textContent = active ? (active.email ?? active.name) : ''
  emptyEl.style.display = state.accounts.length ? 'none' : 'flex'
  // App shortcuts only make sense with an account to open them for
  calendarEl.classList.toggle('hidden', !active)
  meetEl.classList.toggle('hidden', !active)
  driveEl.classList.toggle('hidden', !active)
})

export {}
