// Takes an icon image with a BLACK background and produces assets/icon.png with
// a WHITE background and rounded corners (macOS app style, transparent outside
// the rounding). The black background is replaced with white using a smooth
// transition (max-channel coverage) to avoid halos around the artwork's edges.
// Usage: npx electron scripts/whiten-icon.cjs "/path/to/black-image.png"
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const SIZE = 2048
const RX = 460 // ~22.5% -> macOS rounded corners

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const srcPath = process.argv[2]
  if (!srcPath || !fs.existsSync(srcPath)) {
    console.error('missing a valid image path')
    app.exit(1)
    return
  }
  const b64 = fs.readFileSync(srcPath).toString('base64')

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{margin:0;padding:0}html,body{width:${SIZE}px;height:${SIZE}px;background:transparent}
    canvas{display:block}
  </style></head><body>
  <canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
  <script>
    const img = new Image();
    img.onload = () => {
      const c = document.getElementById('c');
      const x = c.getContext('2d');
      const S = ${SIZE}, rx = ${RX};
      // Rounded clip (transparent corners)
      x.beginPath();
      x.moveTo(rx,0);
      x.arcTo(S,0,S,rx,rx);
      x.arcTo(S,S,S-rx,S,rx);
      x.arcTo(0,S,0,S-rx,rx);
      x.arcTo(0,0,rx,0,rx);
      x.closePath();
      x.clip();
      // Draw the source scaled to the full canvas
      x.drawImage(img,0,0,S,S);
      // Black background -> white with a smooth max-channel transition
      const d = x.getImageData(0,0,S,S), p = d.data;
      const lo = 8, hi = 70;
      for (let i=0;i<p.length;i+=4){
        if (p[i+3]===0) continue; // outside the clip
        const m = Math.max(p[i],p[i+1],p[i+2]);
        let t = (m-lo)/(hi-lo); t = t<0?0:t>1?1:t;
        const cov = t*t*(3-2*t); // smoothstep
        const w = 255*(1-cov);
        p[i]   = p[i]*cov + w;
        p[i+1] = p[i+1]*cov + w;
        p[i+2] = p[i+2]*cov + w;
      }
      x.putImageData(d,0,0);
      window.__done = true;
    };
    img.src = 'data:image/png;base64,${b64}';
  </script></body></html>`

  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    roundedCorners: false,
    backgroundColor: '#00000000',
    useContentSize: true,
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  // Wait for the image to decode and be processed
  for (let i = 0; i < 60; i++) {
    const done = await win.webContents.executeJavaScript('window.__done === true')
    if (done) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await new Promise((r) => setTimeout(r, 200))
  const image = await win.webContents.capturePage()
  fs.writeFileSync(path.join(process.cwd(), 'assets/icon.png'), image.toPNG())
  app.exit(0)
})
