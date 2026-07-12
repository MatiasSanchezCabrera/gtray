# GTray — Backlog

Living list of future improvements. The user feeds it; the order is not a fixed
priority until agreed. For architecture and how the app works, see `CLAUDE.md`.

## Pending / ideas

- **Improve the logo** — the current icon (envelope on a tray, raster) is fine,
  but it can be iterated on.
- **Keep the Firefox UA version fresh** — the spoofed UA in `main.ts` ages as
  real Firefox releases monthly. Meet rejects browsers older than
  current-minus-two (Gmail is more tolerant). Bump it every few months, or
  automate fetching the current version.
- **Intel build (only if someone asks)** — Electron/electron-builder can
  cross-build x64 from the arm64 runner (`--arm64 --x64`, or `--universal`
  for a single fat dmg at ~2x size; the `${arch}` artifactName already
  handles naming). Real cost is support: no Intel hardware to test on
  (Rosetta 2 covers smoke tests only) and notarization runs twice. Intel
  Macs are 2020-and-older and macOS Tahoe (26) is their last major version,
  so don't build this preemptively. If requested, prefer the universal
  binary + single download button.
- **Per-account tabs (parked experiment)** — Calendar/Meet/Drive as tabs
  inside the main window instead of separate windows, with a pill strip in
  the topbar scoped to the active account. Working prototype in the
  `experiment/account-tabs` branch; the user wasn't sold on it yet. Known
  loose end noted in the branch's commit message.
- **Cross-platform: Windows and Linux (post-launch, if there's demand)** —
  the app core is portable (isolated sessions, Atom polling, login disguise,
  update check); the design decision is how the unread counter degrades per
  platform:
  - Windows: near-parity via taskbar overlay icon (`win.setOverlayIcon`)
    acting as the badge. Convention: close minimizes to tray and keeps
    counting. Caveat: unsigned builds trigger SmartScreen ("Windows
    protected your PC") — real distribution needs a code-signing cert
    (OV or Azure Trusted Signing), a separate budget decision.
  - Linux: no global counter (Unity badge API is dead, GNOME has no tray by
    default) — rely on the in-app per-account sidebar counters, offer a tray
    icon with a drawn count where available (KDE; GNOME needs the
    AppIndicator extension). Close quits.
  - Both: no 52px top bar outside macOS (it only exists to host the traffic
    lights) — native window frame and `TOP_BAR_HEIGHT = 0`, sidebar full
    height. Platform-appropriate Firefox UA string for the Google login.
    Packaging via electron-builder (NSIS for Windows; AppImage + deb for
    Linux, checksums only) with CI jobs per OS.
- _(add whatever comes up here)_

## Done (summary)

- Multi-account Gmail wrapper with Dock counters (no OAuth, Atom feed).
- Login unlocked for any Gmail account (Firefox disguise + preload in login
  popups).
- Light/native redesign: top row with traffic lights, white sidebar.
- Real profile photos, custom icon, packaged as a `.app`.
- Near-instant counter updates when reading mail.
