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
