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

type TabId = 'gmail' | 'calendar' | 'meet' | 'drive'

interface State {
  accounts: AccountState[]
  update: { version: string } | null
  tabs: { open: TabId[]; active: TabId } | null
}

interface TrayApi {
  onState: (callback: (state: State) => void) => void
  select: (id: string) => void
  add: () => void
  accountMenu: (id: string) => void
  donate: () => void
  openApp: (app: 'calendar' | 'meet' | 'drive') => void
  selectTab: (tab: TabId) => void
  closeTab: (tab: TabId) => void
  updateDownload: () => void
  updateDismiss: () => void
}

declare global {
  interface Window {
    tray: TrayApi
  }
}

const accountsEl = document.getElementById('accounts') as HTMLElement
const tabsEl = document.getElementById('tabs') as HTMLElement
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
updateGoEl.addEventListener('click', () => window.tray.updateDownload())
updateCloseEl.addEventListener('click', () => window.tray.updateDismiss())

window.tray.onState((state) => {
  updateEl.classList.toggle('hidden', !state.update)
  if (state.update) {
    updateGoEl.textContent = `Update to ${state.update.version}`
    updateGoEl.title = `GTray ${state.update.version} is available — download the new version`
  }

  accountsEl.textContent = ''
  for (const account of state.accounts) {
    const button = document.createElement('button')
    button.className = 'avatar' + (account.active ? ' active' : '')
    button.style.setProperty('--color', account.color)
    button.title = account.email ?? account.name

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
    accountsEl.appendChild(button)
  }

  const active = state.accounts.find((a) => a.active)
  renderTabs(active ? (active.email ?? active.name) : '', state.tabs)
  emptyEl.style.display = state.accounts.length ? 'none' : 'flex'
  // App shortcuts only make sense with an account to open them for
  calendarEl.classList.toggle('hidden', !active)
  meetEl.classList.toggle('hidden', !active)
  driveEl.classList.toggle('hidden', !active)
})

const TAB_LABELS: Record<TabId, string> = {
  gmail: 'Gmail',
  calendar: 'Calendar',
  meet: 'Meet',
  drive: 'Drive',
}

function renderTabs(accountTitle: string, tabs: State['tabs']): void {
  tabsEl.textContent = ''
  // Only the inbox open: plain account title, like before tabs existed
  if (!tabs || tabs.open.length <= 1) {
    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = accountTitle
    tabsEl.appendChild(title)
    return
  }
  for (const tab of tabs.open) {
    const button = document.createElement('button')
    button.className = 'tab' + (tab === tabs.active ? ' active' : '')
    if (tab !== 'gmail') {
      const icon = document.createElement('img')
      icon.src = `${tab}.svg`
      icon.alt = ''
      button.appendChild(icon)
    }
    button.appendChild(
      document.createTextNode(tab === 'gmail' ? accountTitle : TAB_LABELS[tab]),
    )
    button.title = TAB_LABELS[tab]
    button.addEventListener('click', () => window.tray.selectTab(tab))
    if (tab !== 'gmail') {
      const close = document.createElement('span')
      close.className = 'close'
      close.textContent = '✕'
      close.title = `Close ${TAB_LABELS[tab]}`
      close.addEventListener('click', (event) => {
        event.stopPropagation()
        window.tray.closeTab(tab)
      })
      button.appendChild(close)
    }
    tabsEl.appendChild(button)
  }
}

export {}
