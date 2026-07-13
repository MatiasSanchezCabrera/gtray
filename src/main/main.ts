import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, nativeImage, shell, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { Account, ConfigData, loadConfig, saveConfig } from './config'
import { fetchUnread } from './polling'
import { DMG_URL, fetchLatestVersion, isNewer, RELEASE_URL } from './updates'
import { SIDEBAR_WIDTH, ViewManager } from './views'
import { updateBadges } from './badges'
import { runCookieSpike } from './cookie-import'

const COLORS = ['#1a73e8', '#188038', '#e8710a', '#9334e6', '#d93025', '#129eaf']
const POLL_ESTABLISHED_MS = 60_000
const POLL_PENDING_MS = 5_000 // freshly added account: detect the login quickly
const UPDATE_CHECK_MS = 24 * 60 * 60 * 1000 // daily
const DONATION_URL = 'https://ko-fi.com/matias_sanchez'
// Google apps openable from the topbar, in the active account's session
const APP_URLS: Record<string, string> = {
  calendar: 'https://calendar.google.com/',
  meet: 'https://meet.google.com/',
  drive: 'https://drive.google.com/',
}

app.setName('GTray')

// Migration for the Tray -> GTray rename: userData (Gmail sessions and config)
// used to live in .../Application Support/Tray. Renamed once so logins are not
// lost. Must run before the single-instance lock and before any session is created.
const oldUserData = path.join(app.getPath('appData'), 'Tray')
const newUserData = path.join(app.getPath('appData'), 'GTray')
if (!fs.existsSync(newUserData) && fs.existsSync(oldUserData)) {
  fs.renameSync(oldUserData, newUserData)
}

// Google blocks logins from embedded Chromium ("This browser or app may not be
// secure"), even with a Chrome UA, because internal fingerprints that real
// Chrome has are missing. The robust mitigation is to present as Firefox
// consistently across the whole app: Google doesn't demand those fingerprints
// from Firefox and Gmail works fine. Global (non-dynamic) UA so the HTTP header
// and navigator.userAgent always match, including in login popups.
// Keep the version close to the real current Firefox: Meet (unlike Gmail)
// refuses to start calls on browsers older than current-minus-two.
app.userAgentFallback =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0'

if (!app.requestSingleInstanceLock()) app.exit(0)

let config: ConfigData
let win: BrowserWindow | null = null
let views: ViewManager | null = null
let quitting = false
let menuSignature: string | null = null
let availableUpdate: string | null = null // latest version, when newer than ours
const status = new Map<string, { unread: number; authError: boolean; lastPoll: number }>()

function snapshot() {
  return config.accounts.map((a) => {
    const st = status.get(a.id)
    return {
      id: a.id,
      name: a.name,
      email: a.email,
      color: a.color,
      photoUrl: a.photoUrl ?? null,
      unread: st?.unread ?? 0,
      authError: st?.authError ?? false,
      active: a.id === config.activeAccountId,
      pending: !a.email,
    }
  })
}

function pushState(): void {
  const accounts = snapshot()
  const update =
    availableUpdate && availableUpdate !== config.dismissedUpdateVersion
      ? { version: availableUpdate }
      : null
  win?.webContents.send('state', { accounts, update })
  updateBadges(
    accounts.map((a) => ({
      id: a.id,
      label: a.email ?? a.name,
      unread: a.unread,
      authError: a.authError,
    })),
  )
  const signature = config.accounts.map((a) => a.email ?? a.id).join('|')
  if (signature !== menuSignature) {
    menuSignature = signature
    buildMenu()
  }
}

function selectAccount(id: string | null, persist = true): void {
  config.activeAccountId = id
  views?.setActive(id)
  if (persist) saveConfig(config)
  pushState()
}

// Polls one account's feed and updates its status. Returns whether anything changed.
async function pollAccount(account: Account): Promise<boolean> {
  if (!views) return false
  const st = status.get(account.id) ?? { unread: 0, authError: false, lastPoll: 0 }
  status.set(account.id, st)
  st.lastPoll = Date.now()
  const result = await fetchUnread(views.sessionFor(account.id))
  let changed = false
  if (result.ok) {
    if (st.unread !== result.count || st.authError) changed = true
    st.unread = result.count
    st.authError = false
    if (!account.email && result.email) {
      account.email = result.email
      account.name = result.email.split('@')[0]
      saveConfig(config)
      changed = true
    }
  } else if (result.reason === 'auth' && account.email && !st.authError) {
    st.authError = true
    st.unread = 0
    changed = true
  }
  // Network errors: keep the last known count
  return changed
}

// Interacting with Gmail (reading/archiving) changes its tab title; we poll the
// feed right away so the counter updates almost instantly. Debounced because the
// title changes a lot (opening mails, navigating).
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>()
function onGmailActivity(id: string): void {
  const existing = activityTimers.get(id)
  if (existing) clearTimeout(existing)
  activityTimers.set(
    id,
    setTimeout(() => {
      activityTimers.delete(id)
      const account = config.accounts.find((a) => a.id === id)
      if (account) void pollAccount(account).then((changed) => changed && pushState())
    }, 800),
  )
}

// Reads the profile photo from the logged-in Gmail. Runs in the page via
// executeJavaScript (no IPC, no OAuth). Gmail loads the avatar lazily, so it
// retries for a few seconds after each load until it finds it.
const GET_PHOTO_JS = `(() => {
  const acct = document.querySelector('a[aria-label^="Google Account"] img, a[href*="SignOutOptions"] img');
  const img = acct || Array.from(document.images).find((i) => i.src.includes('googleusercontent.com'));
  if (!img || !img.src) return null;
  return img.src.replace(/=s\\d+(-[a-z]+)*$/i, '=s96');
})()`

function extractPhoto(account: Account, wc: WebContents): void {
  const attempt = (tries: number): void => {
    if (wc.isDestroyed()) return
    wc.executeJavaScript(GET_PHOTO_JS)
      .then((url: unknown) => {
        if (typeof url === 'string' && url) {
          if (account.photoUrl !== url) {
            account.photoUrl = url
            saveConfig(config)
            pushState()
          }
        } else if (tries > 0) {
          setTimeout(() => attempt(tries - 1), 1500)
        }
      })
      .catch(() => {
        if (tries > 0) setTimeout(() => attempt(tries - 1), 1500)
      })
  }
  wc.on('did-finish-load', () => attempt(5))
}

function addAccount(): void {
  const account: Account = {
    id: randomUUID(),
    email: null,
    name: `Account ${config.accounts.length + 1}`,
    color: COLORS[config.accounts.length % COLORS.length],
  }
  config.accounts.push(account)
  status.set(account.id, { unread: 0, authError: false, lastPoll: 0 })
  const view = views?.create(account.id, () => onGmailActivity(account.id))
  if (view) extractPhoto(account, view.webContents)
  selectAccount(account.id)
}

async function removeAccount(id: string): Promise<void> {
  const account = config.accounts.find((a) => a.id === id)
  if (!account || !win || !views) return
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: `Remove account ${account.email ?? account.name}?`,
    detail: 'This signs the account out and deletes its local data. Your Gmail messages are not touched.',
    buttons: ['Remove', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  })
  if (response !== 0) return
  views.destroy(id)
  await views.sessionFor(id).clearStorageData()
  const timer = activityTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    activityTimers.delete(id)
  }
  config.accounts = config.accounts.filter((a) => a.id !== id)
  status.delete(id)
  if (config.activeAccountId === id) {
    selectAccount(config.accounts[0]?.id ?? null)
  } else {
    saveConfig(config)
    pushState()
  }
}

// Floating tooltip next to the account rail. It's a tiny frameless child
// window (not DOM) because the Gmail WebContentsView would cover any HTML
// tooltip that leaves the 72px sidebar. See tooltip.html.
let tooltipWin: BrowserWindow | null = null
let tooltipSeq = 0 // invalidates in-flight shows when the pointer already left

async function showAccountTooltip(text: string, y: number): Promise<void> {
  if (!win) return
  const seq = ++tooltipSeq
  if (!tooltipWin || tooltipWin.isDestroyed()) {
    tooltipWin = new BrowserWindow({
      width: 10,
      height: 10,
      parent: win,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      show: false,
      hasShadow: false,
      skipTaskbar: true,
    })
    tooltipWin.setIgnoreMouseEvents(true)
    await tooltipWin.loadFile(path.join(__dirname, '../sidebar/tooltip.html'))
  }
  const size = (await tooltipWin.webContents.executeJavaScript(
    `(() => {
      const p = document.getElementById('pill');
      p.textContent = ${JSON.stringify(text)};
      return { w: p.offsetWidth, h: p.offsetHeight };
    })()`,
  )) as { w: number; h: number }
  if (seq !== tooltipSeq || !win) return // pointer left while we measured
  const bounds = win.getContentBounds()
  tooltipWin.setBounds({
    x: Math.round(bounds.x + SIDEBAR_WIDTH + 6),
    y: Math.round(bounds.y + y - size.h / 2),
    width: Math.ceil(size.w),
    height: Math.ceil(size.h),
  })
  tooltipWin.showInactive()
}

function hideAccountTooltip(): void {
  tooltipSeq++
  tooltipWin?.hide()
}

async function pollTick(force = false): Promise<void> {
  if (!views) return
  const now = Date.now()
  const results = await Promise.all(
    config.accounts.map((account) => {
      const st = status.get(account.id) ?? { unread: 0, authError: false, lastPoll: 0 }
      status.set(account.id, st)
      const interval = account.email ? POLL_ESTABLISHED_MS : POLL_PENDING_MS
      if (!force && now - st.lastPoll < interval) return Promise.resolve(false)
      return pollAccount(account)
    }),
  )
  if (results.some(Boolean)) pushState()
}

// Automatic check: silent — on a hit it lights up the sidebar pill via pushState.
async function checkForUpdates(): Promise<void> {
  const latest = await fetchLatestVersion()
  if (latest && isNewer(latest, app.getVersion())) {
    if (availableUpdate !== latest) {
      availableUpdate = latest
      pushState()
    }
  }
}

// Manual check (menu): always reports the result in a dialog, even when
// up to date, and ignores any dismissed pill.
async function checkForUpdatesInteractive(): Promise<void> {
  const latest = await fetchLatestVersion()
  if (!latest) {
    dialog.showMessageBox({
      type: 'warning',
      message: 'Could not check for updates',
      detail: 'gtray.app is unreachable. Check your connection and try again.',
    })
    return
  }
  if (!isNewer(latest, app.getVersion())) {
    dialog.showMessageBox({
      type: 'info',
      message: "You're up to date",
      detail: `GTray ${app.getVersion()} is the latest version.`,
    })
    return
  }
  availableUpdate = latest
  config.dismissedUpdateVersion = null // a manual check un-dismisses the pill
  saveConfig(config)
  pushState()
  await showUpdateDialog(latest)
}

// Update hub, opened by the manual check and by the topbar pill: download
// the dmg or read the release notes on GitHub.
async function showUpdateDialog(latest: string): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: `GTray ${latest} is available`,
    detail: `You have ${app.getVersion()}. The download replaces the app in /Applications; your accounts and sessions are kept.`,
    buttons: ['Download', 'Release Notes', 'Later'],
    defaultId: 0,
    cancelId: 2,
  })
  if (response === 0) void shell.openExternal(DMG_URL)
  if (response === 1) void shell.openExternal(RELEASE_URL)
}

function buildMenu(): void {
  const accountItems: MenuItemConstructorOptions[] = config.accounts.slice(0, 9).map((a, i) => ({
    label: a.email ?? a.name,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => {
      win?.show()
      selectAccount(a.id)
    },
  }))
  const template: MenuItemConstructorOptions[] = [
    {
      // Custom app menu: the default one (role: 'appMenu') can't host the
      // update entries
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => void checkForUpdatesInteractive(),
        },
        {
          label: 'Check for Updates Automatically',
          type: 'checkbox',
          checked: config.updateCheck,
          click: (item) => {
            config.updateCheck = item.checked
            saveConfig(config)
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Account…',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            win?.show()
            addAccount()
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Account',
          accelerator: 'CmdOrCtrl+R',
          click: () => views?.active()?.webContents.reload(),
        },
        {
          label: 'DevTools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: () => {
            // App windows (Calendar, Meet, Drive) get their own devtools;
            // in the main window it targets the active Gmail view
            const focused = BrowserWindow.getFocusedWindow()
            if (focused && focused !== win) {
              focused.webContents.openDevTools({ mode: 'detach' })
            } else {
              views?.active()?.webContents.openDevTools({ mode: 'detach' })
            }
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Accounts',
      submenu: accountItems.length ? accountItems : [{ label: 'No Accounts', enabled: false }],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const ws = config.windowState
  win = new BrowserWindow({
    x: ws.x,
    y: ws.y,
    width: ws.width,
    height: ws.height,
    minWidth: 900,
    minHeight: 600,
    title: 'GTray',
    titleBarStyle: 'hiddenInset',
    // Traffic lights placed inside the top row (52px tall)
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  })
  void win.loadFile(path.join(__dirname, '../sidebar/index.html'))

  views = new ViewManager(win)
  for (const account of config.accounts) {
    status.set(account.id, { unread: 0, authError: false, lastPoll: 0 })
    const view = views.create(account.id, () => onGmailActivity(account.id))
    extractPhoto(account, view.webContents)
  }
  if (config.activeAccountId && !config.accounts.some((a) => a.id === config.activeAccountId)) {
    config.activeAccountId = null
  }
  selectAccount(config.activeAccountId ?? config.accounts[0]?.id ?? null, false)

  win.webContents.on('did-finish-load', () => pushState())
  // Closing the window hides it; the app keeps updating counters. Cmd+Q quits.
  win.on('close', (event) => {
    config.windowState = win!.getBounds()
    saveConfig(config)
    if (!quitting) {
      event.preventDefault()
      win!.hide()
    }
  })
  win.on('focus', () => void pollTick(true))
  win.on('blur', hideAccountTooltip)
  win.on('move', hideAccountTooltip)
}

void app.whenReady().then(() => {
  // Throwaway spike: `npm run spike` transplants a Chrome Google session into
  // an Electron partition to see if Gmail loads logged in. Inert otherwise.
  if (process.argv.includes('--cookie-spike')) {
    void runCookieSpike()
    return
  }

  config = loadConfig()

  // Dock icon. A packaged app gets it from the bundle (.icns), but in
  // development (`electron .`) it must be set manually. __dirname = dist/main.
  const dockIcon = path.join(__dirname, '../../assets/icon-512.png')
  if (app.dock && fs.existsSync(dockIcon)) {
    app.dock.setIcon(nativeImage.createFromPath(dockIcon))
  }

  ipcMain.on('select-account', (_event, id: string) => selectAccount(id))
  ipcMain.on('add-account', () => addAccount())
  ipcMain.on('donate', () => void shell.openExternal(DONATION_URL))
  ipcMain.on('open-app', (_event, appId: string) => {
    const url = APP_URLS[appId]
    if (url && config.activeAccountId) views?.openApp(config.activeAccountId, url)
  })
  ipcMain.on('update-open', () => {
    if (availableUpdate) void showUpdateDialog(availableUpdate)
  })
  ipcMain.on('update-dismiss', () => {
    config.dismissedUpdateVersion = availableUpdate
    saveConfig(config)
    pushState()
  })
  ipcMain.on('account-tooltip', (_event, payload: { text: string; y: number } | null) => {
    if (payload && typeof payload.text === 'string' && typeof payload.y === 'number') {
      void showAccountTooltip(payload.text, payload.y)
    } else {
      hideAccountTooltip()
    }
  })
  ipcMain.on('account-menu', (_event, id: string) => {
    if (!win) return
    hideAccountTooltip()
    Menu.buildFromTemplate([
      { label: 'Reload', click: () => views?.get(id)?.webContents.reload() },
      { type: 'separator' },
      { label: 'Remove Account…', click: () => void removeAccount(id) },
    ]).popup({ window: win })
  })

  buildMenu()
  createWindow()

  setInterval(() => void pollTick(), POLL_PENDING_MS)
  void pollTick(true)

  // Daily update check (a few seconds after launch so startup stays snappy).
  // The toggle is read at fire time, so changing it needs no rescheduling.
  setTimeout(() => {
    if (config.updateCheck) void checkForUpdates()
  }, 10_000)
  setInterval(() => {
    if (config.updateCheck) void checkForUpdates()
  }, UPDATE_CHECK_MS)

  if (process.argv.includes('--smoke')) {
    setTimeout(() => {
      console.log('SMOKE_OK')
      app.exit(0)
    }, 4000)
  }
})

app.on('second-instance', () => win?.show())
app.on('activate', () => win?.show())
app.on('before-quit', () => {
  quitting = true
})
app.on('window-all-closed', () => {
  // The app keeps running in the background to keep the counters fresh
})
