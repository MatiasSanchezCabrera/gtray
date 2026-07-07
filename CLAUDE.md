# GTray

macOS app that **wraps Gmail web**: several Gmail inboxes in one window, with
the web experience intact and unread counters always visible in the Dock.
Personal use; open source, with possible future monetization as a mini-app.

Not a mail client of its own: it is a wrapper around `mail.google.com` with an
account sidebar. Each inbox keeps its session isolated.

## Stack

- **Electron 43** + **TypeScript** (strict), bundled with **esbuild** (`build.mjs`).
  No UI frameworks: the sidebar is hand-written HTML/CSS/TS.
- Packaged with **electron-builder** (unsigned `.app`, for local builds).
- Environment: **no Xcode required** — the whole toolchain is JS
  (Node/npm, e.g. via Homebrew).

## Commands

```sh
npm run typecheck   # tsc --noEmit
npm start           # build + launch in development (electron .)
npm run dist        # build + package release/mac-arm64/GTray.app
```

### Cycle to update the app installed in /Applications

The development version (`npm start`) and the installed one share the app name
(`GTray`, see `app.setName`) and therefore the **same userData** (sessions and
config): no need to log in again when switching between them, but **only one
can run at a time** (single-instance lock).

```sh
osascript -e 'tell application "GTray" to quit'   # quit the installed app
npm run dist
rm -rf /Applications/GTray.app && cp -R release/mac-arm64/GTray.app /Applications/
killall Dock            # refresh the icon cache
open -a /Applications/GTray.app
```

## Architecture

```
src/main/                 main process (Node)
  main.ts                 lifecycle, window, menu, IPC, polling loop
  config.ts               config.json in userData (accounts, window, active account)
  views.ts                one Gmail WebContentsView per account; popups, links, downloads
  polling.ts              Gmail Atom feed -> unread count + account email
  badges.ts               Dock badge (Dock only; no menu bar icon)
  preload.ts              sidebar IPC bridge (contextIsolation ON)
  gmail-preload.ts        injected into the Gmail views (contextIsolation OFF)
src/renderer/sidebar/     sidebar UI (index.html, sidebar.css, sidebar.ts)
build.mjs                 esbuild -> dist/
scripts/whiten-icon.cjs   generates assets/icon.png from the source (see assets/README.md)
landing/                  gtray.app website (static HTML/CSS/JS, no build step)
.github/workflows/
  release.yml             v* tag -> build + .dmg + checksums -> GitHub Release
                          (signs/notarizes only if the Apple secrets exist)
  pages.yml               deploys landing/ to GitHub Pages on push to main
```

### How it works (non-obvious parts)

- **Per-account sessions:** each inbox uses
  `session.fromPartition('persist:account-<id>')`, an isolated browser profile.
  Log in once; it persists. All accounts load at startup so switching between
  them is instant.

- **Counters without OAuth:** the Atom feed
  (`mail.google.com/mail/feed/atom`) is fetched with each session's cookies and
  `<fullcount>` is read. No Gmail API, no Google Cloud Console.
  - Background polling every 60s (5s for freshly added accounts, until the
    login and its email are detected).
  - **Near-instant updates:** when the Gmail tab title changes (read/archive),
    that account's feed is polled right away (800ms debounce). See
    `onGmailActivity` / `pollAccount` in main.ts.

- **Google login (critical and fragile):** Google blocks embedded browsers
  ("This browser or app may not be secure"). Layered mitigation:
  1. Global **Firefox** UA (`app.userAgentFallback` in main.ts) — consistent
     across the header and `navigator.userAgent`.
  2. `Sec-CH-*` client hints are stripped on Google hosts (views.ts).
  3. `gmail-preload.ts` (contextIsolation OFF) hides Chromium fingerprints:
     `userAgentData`, `window.chrome`, `vendor`, `productSub`, `buildID`,
     `webdriver`, WebGL.
  4. **Login popups also get this preload** (this was the piece that unlocked
     adding any account — see `overrideBrowserWindowOptions` in views.ts).
     Without it, some popup login flows are blocked.
  - If Google hardens its detection, this is the place to reinforce. Accounts
    with Advanced Protection might not get in by design (not confirmed that
    they block; in testing every normal account got in).

- **Browser behavior:** external links → default browser; Gmail popups
  (Compose) → own window; downloads → ~/Downloads; closing the window hides it
  and the app keeps counting in the background (⌘Q quits).

- **Profile photos:** extracted from the logged-in Gmail via `executeJavaScript`
  (no OAuth), cached in config, with a colored-initial fallback.

- **Window layout:** full-width 52px top row (light gray) hosting the macOS
  traffic lights; 72px white sidebar below it; Gmail (WebContentsView) takes
  the rest (x≥72, y≥52). The `SIDEBAR_WIDTH` / `TOP_BAR_HEIGHT` constants in
  views.ts must match the sidebar CSS.

- **Icon:** raster (not vector). Source in `assets/icon-source.png`; processed
  with `scripts/whiten-icon.cjs` (rounded crop + black→white if needed) which
  generates the icns/png. See `assets/README.md`.

- **Landing assets are copies:** `landing/icon.png` is a copy of
  `assets/icon-512.png` and `landing/lexend.woff2` a copy of the sidebar font.
  If the app icon or font ever changes, re-copy them by hand or the website
  drifts out of sync.

- **Landing is bilingual:** `landing/es/index.html` (gtray.app/es) is a
  translated copy of `landing/index.html` — same markup/CSS, texts in neutral
  Latin American Spanish. Any copy or design change to one page must be
  replicated in the other. Both declare `hreflang` and link to each other from
  the header.

## Conventions

- **Everything in English**: code comments, commit messages, UI copy and docs.
  Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- TypeScript strict; no runtime dependencies (everything is devDependencies).
- UI/icon changes: verify visually before committing (render + Read of the
  image for the icon; the user reviews the window).
- Backlog of future improvements in `BACKLOG.md`.
