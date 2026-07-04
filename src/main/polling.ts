import { Session } from 'electron'

// Gmail's Atom feed returns the inbox unread count using the session's
// cookies — no OAuth, no Gmail API.
const FEED_URL = 'https://mail.google.com/mail/feed/atom'

export type FeedResult =
  | { ok: true; count: number; email: string | null }
  | { ok: false; reason: 'auth' | 'network' }

export async function fetchUnread(ses: Session): Promise<FeedResult> {
  try {
    const res = await ses.fetch(FEED_URL, { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return { ok: false, reason: res.status === 401 ? 'auth' : 'network' }
    const body = await res.text()
    const count = body.match(/<fullcount>(\d+)<\/fullcount>/)
    // Without a session, Gmail redirects to the login page (HTML without <fullcount>)
    if (!count) return { ok: false, reason: 'auth' }
    const email = body.match(/Inbox for (\S+?)<\//)
    return { ok: true, count: parseInt(count[1], 10), email: email ? email[1] : null }
  } catch {
    return { ok: false, reason: 'network' }
  }
}
