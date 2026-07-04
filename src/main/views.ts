import { app, BrowserWindow, Session, session, shell, WebContents, WebContentsView } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

const GMAIL_PRELOAD = path.join(__dirname, 'gmail-preload.js')

export const SIDEBAR_WIDTH = 72
export const TOP_BAR_HEIGHT = 52

const GMAIL_URL = 'https://mail.google.com/mail/u/0/'

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

export function wireGmailContents(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    // Gmail popups (Compose, print) and login popups → own window
    if (url === 'about:blank' || isGoogleHost(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 720,
          title: 'GTray',
          // Login popups need the Firefox disguise too
          webPreferences: {
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
  wc.on('did-create-window', (child) => wireGmailContents(child.webContents))
  wc.on('will-navigate', (event, url) => {
    if (!isGoogleHost(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

export class ViewManager {
  private views = new Map<string, WebContentsView>()
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
    const view = this.views.get(id)
    if (!view) return
    this.win.contentView.removeChildView(view)
    view.webContents.close()
    this.views.delete(id)
    if (this.activeId === id) this.activeId = null
  }
}
