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
  onState: (callback: (state: { accounts: AccountState[] }) => void) => void
  select: (id: string) => void
  add: () => void
  accountMenu: (id: string) => void
  donate: () => void
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

window.tray.onState((state) => {
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
  titleEl.textContent = active ? (active.email ?? active.name) : ''
  emptyEl.style.display = state.accounts.length ? 'none' : 'flex'
})

export {}
