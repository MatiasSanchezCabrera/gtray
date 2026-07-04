# GTray icon

An envelope entering an inbox tray (teal + navy) on a white background with
macOS-style rounded corners.

- `icon-source.png` — source image (render with relief/shadows, white background).
- `icon.png` — final 4096px icon: source cropped to rounded corners
  (transparent outside the rounding).
- `icon-512.png` — Dock version for development (`app.dock.setIcon`).
- `icon.icns` — for packaging with electron-builder (`build.mac.icon`).

## Regenerate

```sh
# Crop rounded corners + (if needed) turn a black background white:
npx electron scripts/whiten-icon.cjs assets/icon-source.png   # -> assets/icon.png
# icns + dock png:
cd assets && mkdir -p icon.iconset
for s in 16 32 128 256 512; do \
  sips -z $s $s icon.png --out icon.iconset/icon_${s}x${s}.png; \
  d=$((s*2)); sips -z $d $d icon.png --out icon.iconset/icon_${s}x${s}@2x.png; done
sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
sips -z 512 512 icon.png --out icon-512.png
rm -rf icon.iconset
```
