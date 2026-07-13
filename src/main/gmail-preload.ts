// Injected into the main world BEFORE the page's scripts (contextIsolation:false).
// The global UA says Firefox, but Chromium leaves JS fingerprints that expose
// the real engine and make Google's strict login flag "browser not secure".
// Here we hide those fingerprints so the Firefox disguise stays consistent.
// Firefox exposes none of these APIs (or exposes different ones), so aligning
// them brings us closer to its real environment. Gmail works in Firefox, so it
// doesn't need them.

function def(obj: object, prop: string, getter: () => unknown): void {
  try {
    Object.defineProperty(obj, prop, { get: getter, configurable: true })
  } catch {}
}

function hide(): void {
  // navigator.userAgentData: Chromium-only
  def(Navigator.prototype, 'userAgentData', () => undefined)
  // navigator.vendor: "Google Inc." in Chromium, "" in Firefox
  def(Navigator.prototype, 'vendor', () => '')
  // navigator.productSub: "20030107" in Chromium, "20100101" in Firefox
  def(Navigator.prototype, 'productSub', () => '20100101')
  // navigator.oscpu: Firefox-only; its absence under a Firefox UA gives us away
  def(Navigator.prototype, 'oscpu', () => 'Intel Mac OS X 10.15')
  // navigator.buildID: Firefox exposes a fixed value for privacy
  def(Navigator.prototype, 'buildID', () => '20181001000000')
  // navigator.webdriver: must be false (Firefox and regular Chrome)
  def(Navigator.prototype, 'webdriver', () => false)
  // window.chrome: only exists in Chromium
  try {
    Object.defineProperty(window, 'chrome', { get: () => undefined, configurable: true })
  } catch {}

  // WebGL: Chromium reports "Google Inc."/ANGLE; masked so it doesn't give us away.
  try {
    const proto = (window as unknown as { WebGLRenderingContext?: { prototype: WebGLRenderingContext } })
      .WebGLRenderingContext?.prototype
    if (proto) {
      const original = proto.getParameter
      proto.getParameter = function (this: WebGLRenderingContext, param: number): unknown {
        if (param === 37445) return 'Intel Inc.' // UNMASKED_VENDOR_WEBGL
        if (param === 37446) return 'Intel Iris OpenGL Engine' // UNMASKED_RENDERER_WEBGL
        return original.call(this, param)
      }
    }
  } catch {}
}

hide()

// Two-finger trackpad swipe = history back/forward, like Safari. Electron
// removed the native scroll-touch events, so we rebuild the gesture from
// wheel deltas: accumulate horizontal movement, but only when nothing under
// the pointer can scroll horizontally in that direction (a wide email must
// keep scrolling, not navigate). Fingers moving right = back.
import { ipcRenderer } from 'electron'

const SWIPE_THRESHOLD = 260 // accumulated deltaX before navigating
let swipeAcc = 0
let swipeFired = false
let swipeReset: ReturnType<typeof setTimeout> | undefined

function canScrollHorizontally(start: Element | null, dir: number): boolean {
  for (let el = start; el instanceof Element; el = el.parentElement) {
    const style = getComputedStyle(el)
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      if (dir > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true
      if (dir < 0 && el.scrollLeft > 0) return true
    }
  }
  return false
}

window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) return // pinch gesture
    // Vertical intent, or a real horizontal scroller under the pointer:
    // this is scrolling, not a navigation gesture.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.5 || canScrollHorizontally(e.target as Element, e.deltaX)) {
      swipeAcc = 0
      return
    }
    swipeAcc += e.deltaX
    clearTimeout(swipeReset)
    swipeReset = setTimeout(() => {
      swipeAcc = 0
      swipeFired = false
    }, 250)
    if (swipeFired) return
    if (swipeAcc <= -SWIPE_THRESHOLD) {
      swipeFired = true
      ipcRenderer.send('nav-back')
    } else if (swipeAcc >= SWIPE_THRESHOLD) {
      swipeFired = true
      ipcRenderer.send('nav-forward')
    }
  },
  { passive: true },
)
