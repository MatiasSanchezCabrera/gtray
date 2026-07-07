# GTray

[![Downloads](https://img.shields.io/github/downloads/MatiasSanchezCabrera/gtray/total?label=downloads)](https://github.com/MatiasSanchezCabrera/gtray/releases)
[![Latest release](https://img.shields.io/github/v/release/MatiasSanchezCabrera/gtray?label=latest)](https://github.com/MatiasSanchezCabrera/gtray/releases/latest)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](./LICENSE)

All your Gmail inboxes in a single macOS app, with the web experience intact
and your unread count always visible in the Dock.

GTray is not a mail client: it is a lightweight wrapper around
`mail.google.com`. Each account lives in its own isolated session (log in once
and it sticks), you switch inboxes with `⌘1…⌘9`, and the Dock badge adds up
the unread mail of every account even when the window is closed.

**Download:** [Releases](https://github.com/MatiasSanchezCabrera/gtray/releases/latest) ·
**Website:** [gtray.app](https://gtray.app) ·
**Support:** [Ko-fi](https://ko-fi.com/gtray)

> Requires macOS 13+ on Apple Silicon.

## Why

GTray is built around three simple principles:

1. I don't want to check my inbox from a browser tab.
2. Gmail's web experience is just fine — no need to reinvent it.
3. I want to know which account needs my attention at a glance, straight
   from the Dock.

## Why you can trust it

An app that asks you to log into your Gmail deserves skepticism. That's why
GTray is open source and downloads come only from GitHub Releases (built by
GitHub Actions from this code, with published checksums):

- **Your sessions never leave your Mac.** Each account uses an isolated
  browser profile (`session.fromPartition`) stored locally, just like Chrome
  or Safari. There are no GTray servers; there is no telemetry.
- **No OAuth, no API permissions.** Counters are read from Gmail's Atom feed
  (`mail.google.com/mail/feed/atom`) with your own cookies. GTray never sees
  your password: the login happens on Google's real page.
- **Auditable.** All the code is in this repo, and every request the app makes
  goes to Google — with one exception you control: a daily update check
  fetches `gtray.app/version.json` (a plain GET, no identifiers, no cookies).
  Turn it off in **GTray → Check for Updates Automatically**.

## Features

- Several Gmail accounts in one window, instant switching between inboxes.
- Unread counter in the Dock, updated the moment you read or archive.
- Real browser behavior: external links open in your default browser, Compose
  gets its own window, downloads go to ~/Downloads.
- Closing the window doesn't quit the app: it keeps counting in the
  background (`⌘Q` to quit).

### Shortcuts

`⌘1…⌘9` switch inbox · `⌘N` add account · `⌘R` reload

## Development

Requires Node 22+. No Xcode needed.

```sh
npm install
npm run typecheck   # tsc --noEmit
npm start           # development
npm run dist        # packages release/mac-arm64/GTray.app (unsigned)
```

Architecture, decisions and non-obvious details: [`CLAUDE.md`](./CLAUDE.md).
Pending improvements: [`BACKLOG.md`](./BACKLOG.md).

Releases are published with the [`release.yml`](./.github/workflows/release.yml)
workflow: pushing a `v*` tag makes GitHub Actions build, package the `.dmg`
(signed and notarized if the repo has the certificates configured) and upload
it to the Release with its checksums.

## A note on Google login

Google blocks embedded browsers at login. GTray presents itself with a Firefox
user agent and hides Chromium's fingerprints so the flow works (see
`src/main/gmail-preload.ts` and `src/main/views.ts`). This is the most fragile
part of the project: if Google hardens its detection, it may break until the
app is updated.

## Support

If GTray makes your day a little easier, consider
[supporting its development with a beer 🍺](https://ko-fi.com/gtray).
It keeps the updates coming.

## License

[GPL-3.0](./LICENSE). You may use, study, modify and redistribute the code;
any redistribution must keep this same license and publish its source code.
