import { app, BrowserWindow, Session, session, shell, WebContents, WebContentsView } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const GMAIL_PRELOAD = path.join(__dirname, 'gmail-preload.js')

export const SIDEBAR_WIDTH = 72
export const TOP_BAR_HEIGHT = 52

const GMAIL_URL = 'https://mail.google.com/mail/u/0/'

// Meet refuses to start calls under the Firefox disguise (even with a current
// version): Google can see server-side that the network fingerprint is
// Chromium's, not Firefox's. Gmail tolerates the mismatch; Meet doesn't.
// App windows (Calendar, Meet, Drive) never run a login flow — the session
// cookies are already there — so they skip the disguise entirely and present
// as the Chrome build they really are, matching the engine.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`

function isMeetHost(url: string): boolean {
  try {
    return new URL(url).hostname === 'meet.google.com'
  } catch {
    return false
  }
}

// Domains that are browsed inside the app (Gmail + Google's login flow).
// Everything else opens in the default browser.
function isGoogleHost(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return (
      /(^|\.)google\.[a-z]+(\.[a-z]+)?$/.test(host) ||
      /(^|\.)(youtube|googleusercontent|gstatic)\.com$/.test(host)
    )
  } catch {
    return false
  }
}

function dedupPath(dir: string, filename: string): string {
  const ext = path.extname(filename)
  const base = path.basename(filename, ext)
  let candidate = path.join(dir, filename)
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`)
  }
  return candidate
}

const configuredSessions = new WeakSet<Session>()

function configureSession(ses: Session): void {
  if (configuredSessions.has(ses)) return
  configuredSessions.add(ses)
  // Attachments go straight to ~/Downloads, like a browser
  ses.on('will-download', (_event, item) => {
    item.setSavePath(dedupPath(app.getPath('downloads'), item.getFilename()))
  })
  // The global UA is Firefox (see main.ts), but Chromium still sends Sec-CH-UA
  // client hints that reveal "Chromium" and expose the real engine to Google's
  // login. Firefox sends no client hints, so we strip them on Google hosts to
  // keep the headers consistent with the UA.
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*.google.com/*'] }, (details, callback) => {
    const headers = details.requestHeaders
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase().startsWith('sec-ch-')) delete headers[key]
    }
    callback({ requestHeaders: headers })
  })
}

export function wireGmailContents(wc: WebContents, chrome = false): void {
  wc.setWindowOpenHandler(({ url }) => {
    // Meet links (from Gmail or Calendar) can't run under the Firefox
    // disguise: give them a real-Chrome window instead of a regular popup
    if (!chrome && isMeetHost(url)) {
      openAppWindow(wc.session, url)
      return { action: 'deny' }
    }
    // Gmail popups (Compose, print) and login popups → own window
    if (url === 'about:blank' || isGoogleHost(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 720,
          title: 'GTray',
          // Login popups need the Firefox disguise too; popups of Chrome
          // windows keep Chromium's real fingerprints, like their parent
          webPreferences: chrome
            ? {}
            : {
                preload: GMAIL_PRELOAD,
                contextIsolation: false,
                nodeIntegration: false,
                sandbox: false,
              },
        },
      }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('did-create-window', (child) => {
    if (chrome) child.webContents.setUserAgent(CHROME_UA)
    wireGmailContents(child.webContents, chrome)
  })
  wc.on('will-navigate', (event, url) => {
    if (!isGoogleHost(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

// Standalone window for a Google app, signed in via the account's session
// cookies, presenting as real Chrome (no Firefox disguise, no fingerprint
// hiding). See CHROME_UA above for why.
export function openAppWindow(ses: Session, url: string): BrowserWindow {
  configureSession(ses)
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'GTray',
    webPreferences: { session: ses },
  })
  win.webContents.setUserAgent(CHROME_UA)
  wireGmailContents(win.webContents, true)
  void win.loadURL(url)
  return win
}

export type TabId = 'gmail' | 'calendar' | 'meet' | 'drive'

export class ViewManager {
  // Per account: its open tabs. 'gmail' always exists; app tabs are created
  // on demand and closable. Tabs are ephemeral (not persisted across runs).
  private tabs = new Map<string, Map<TabId, WebContentsView>>()
  private activeTab = new Map<string, TabId>()
  private activeId: string | null = null

  constructor(private win: BrowserWindow) {
    win.on('resize', () => this.layout())
  }

  sessionFor(id: string): Session {
    return session.fromPartition(`persist:account-${id}`)
  }

  create(id: string, onActivity: () => void): WebContentsView {
    const ses = this.sessionFor(id)
    configureSession(ses)
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        // The preload must run in the main world to hide Chromium's
        // fingerprints BEFORE the page reads them. nodeIntegration stays false,
        // so Gmail can't touch Node even though they share the world.
        preload: GMAIL_PRELOAD,
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
      },
    })
    wireGmailContents(view.webContents)
    view.webContents.on('page-title-updated', onActivity)
    void view.webContents.loadURL(GMAIL_URL)
    view.setVisible(false)
    this.win.contentView.addChildView(view)
    this.tabs.set(id, new Map([['gmail', view]]))
    this.activeTab.set(id, 'gmail')
    return view
  }

  get(id: string): WebContentsView | undefined {
    return this.tabs.get(id)?.get('gmail')
  }

  // The visible view: the active account's active tab
  active(): WebContentsView | undefined {
    if (!this.activeId) return undefined
    const tab = this.activeTab.get(this.activeId) ?? 'gmail'
    return this.tabs.get(this.activeId)?.get(tab)
  }

  openTabs(id: string): TabId[] {
    return Array.from(this.tabs.get(id)?.keys() ?? [])
  }

  activeTabOf(id: string): TabId {
    return this.activeTab.get(id) ?? 'gmail'
  }

  setActive(id: string | null): void {
    this.activeId = id
    this.refreshVisibility()
  }

  // Opens a Google app (Calendar, Meet, Drive) as a tab of the account,
  // presenting as real Chrome (no Firefox disguise — Meet refuses to start
  // calls under it, see CHROME_UA). Reselects the tab if it is already open.
  openTab(accountId: string, tab: TabId, url: string): void {
    const accountTabs = this.tabs.get(accountId)
    if (!accountTabs) return
    if (!accountTabs.has(tab)) {
      const view = new WebContentsView({
        webPreferences: { session: this.sessionFor(accountId) },
      })
      view.webContents.setUserAgent(CHROME_UA)
      wireGmailContents(view.webContents, true)
      void view.webContents.loadURL(url)
      view.setVisible(false)
      this.win.contentView.addChildView(view)
      accountTabs.set(tab, view)
    }
    this.activeTab.set(accountId, tab)
    this.refreshVisibility()
  }

  selectTab(accountId: string, tab: TabId): void {
    if (!this.tabs.get(accountId)?.has(tab)) return
    this.activeTab.set(accountId, tab)
    this.refreshVisibility()
  }

  // Closing a tab destroys its view (a Meet tab hangs up, like a browser tab)
  closeTab(accountId: string, tab: TabId): void {
    if (tab === 'gmail') return // the inbox is not closable
    const accountTabs = this.tabs.get(accountId)
    const view = accountTabs?.get(tab)
    if (!accountTabs || !view) return
    this.win.contentView.removeChildView(view)
    view.webContents.close()
    accountTabs.delete(tab)
    if (this.activeTab.get(accountId) === tab) this.activeTab.set(accountId, 'gmail')
    this.refreshVisibility()
  }

  private refreshVisibility(): void {
    for (const [accountId, accountTabs] of this.tabs) {
      const visibleTab = accountId === this.activeId ? this.activeTab.get(accountId) : null
      for (const [tabId, view] of accountTabs) view.setVisible(tabId === visibleTab)
    }
    this.layout()
    this.active()?.webContents.focus()
  }

  layout(): void {
    const view = this.active()
    if (!view) return
    const [width, height] = this.win.getContentSize()
    view.setBounds({
      x: SIDEBAR_WIDTH,
      y: TOP_BAR_HEIGHT,
      width: Math.max(0, width - SIDEBAR_WIDTH),
      height: Math.max(0, height - TOP_BAR_HEIGHT),
    })
  }

  destroy(id: string): void {
    const accountTabs = this.tabs.get(id)
    if (!accountTabs) return
    for (const view of accountTabs.values()) {
      this.win.contentView.removeChildView(view)
      view.webContents.close()
    }
    this.tabs.delete(id)
    this.activeTab.delete(id)
    if (this.activeId === id) this.activeId = null
  }
}
