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
- _(add whatever comes up here)_

## Done (summary)

- Multi-account Gmail wrapper with Dock counters (no OAuth, Atom feed).
- Login unlocked for any Gmail account (Firefox disguise + preload in login
  popups).
- Light/native redesign: top row with traffic lights, white sidebar.
- Real profile photos, custom icon, packaged as a `.app`.
- Near-instant counter updates when reading mail.
