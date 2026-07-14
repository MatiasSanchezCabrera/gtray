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

// Domains a GTray window may navigate to in place (Gmail + Google's login
// flow, which bounces through youtube/gstatic for cookie sync). Navigation
// anywhere else opens in the default browser. This governs navigation only;
// which links may open a new GTray window is the stricter isSessionPopup.
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

// Popups that must stay inside GTray because they need the account's session
// cookies: Gmail's own windows (compose pop-out, print, show original),
// attachment viewers on googleusercontent, Calendar, and login popups. Meet
// gets its own real-Chrome window (see isMeetHost). Links to anything else —
// including other Google products like Drive or YouTube — open in the
// default browser.
function isSessionPopup(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return (
      host === 'mail.google.com' ||
      host === 'calendar.google.com' ||
      host === 'accounts.google.com' ||
      /(^|\.)googleusercontent\.com$/.test(host)
    )
  } catch {
    return false
  }
}

// Gmail wraps many email links in Google's redirector
// (https://www.google.com/url?q=<target>). Route on the real target:
// otherwise the redirector counts as a Google URL, opens a GTray window,
// and only then bounces to the default browser.
function unwrapRedirect(url: string): string {
  try {
    const u = new URL(url)
    if (u.pathname === '/url' && isGoogleHost(url)) {
      return u.searchParams.get('q') ?? u.searchParams.get('url') ?? url
    }
  } catch {
    // not a URL; fall through
  }
  return url
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

export function wireGmailContents(wc: WebContents, chrome = false, popup = false): void {
  wc.setWindowOpenHandler(({ url }) => {
    const target = unwrapRedirect(url)
    // Meet links (from Gmail or Calendar) can't run under the Firefox
    // disguise: give them a real-Chrome window instead of a regular popup
    if (!chrome && isMeetHost(target)) {
      openAppWindow(wc.session, target)
      return { action: 'deny' }
    }
    // Gmail popups (Compose, print) and login popups → own window
    if (target === 'about:blank' || isSessionPopup(target)) {
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
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  wc.on('did-create-window', (child) => {
    if (chrome) child.webContents.setUserAgent(CHROME_UA)
    wireGmailContents(child.webContents, chrome, true)
  })
  wc.on('will-navigate', (event, url) => {
    if (!isGoogleHost(url)) {
      event.preventDefault()
      void shell.openExternal(unwrapRedirect(url))
      // An about:blank popup that ends up here was just a vehicle for an
      // external link (window.open + location = url): nothing was ever
      // rendered in it, so close it instead of leaving an empty window
      if (popup && (wc.getURL() === '' || wc.getURL() === 'about:blank')) {
        BrowserWindow.fromWebContents(wc)?.close()
      }
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

export class ViewManager {
  private views = new Map<string, WebContentsView>()
  // Calendar/Meet windows, one per account and app, keyed `<accountId>:<url>`
  private appWindows = new Map<string, BrowserWindow>()
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
    this.views.set(id, view)
    return view
  }

  get(id: string): WebContentsView | undefined {
    return this.views.get(id)
  }

  active(): WebContentsView | undefined {
    return this.activeId ? this.views.get(this.activeId) : undefined
  }

  setActive(id: string | null): void {
    this.activeId = id
    for (const [viewId, view] of this.views) view.setVisible(viewId === id)
    this.layout()
    this.active()?.webContents.focus()
  }

  // Opens a Google app (Calendar, Meet, Drive) in its own window, with the
  // account's session so it lands already signed in. One window per account
  // and app: clicking again focuses the existing one.
  openApp(accountId: string, url: string): void {
    const key = `${accountId}:${url}`
    const existing = this.appWindows.get(key)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return
    }
    const win = openAppWindow(this.sessionFor(accountId), url)
    win.on('closed', () => this.appWindows.delete(key))
    this.appWindows.set(key, win)
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
    for (const [key, appWin] of this.appWindows) {
      if (key.startsWith(`${id}:`) && !appWin.isDestroyed()) appWin.destroy()
    }
    const view = this.views.get(id)
    if (!view) return
    this.win.contentView.removeChildView(view)
    view.webContents.close()
    this.views.delete(id)
    if (this.activeId === id) this.activeId = null
  }
}
