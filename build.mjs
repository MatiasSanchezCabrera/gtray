import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'fs'

await build({
  entryPoints: ['src/main/main.ts', 'src/main/preload.ts', 'src/main/gmail-preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outdir: 'dist/main',
})

await build({
  entryPoints: ['src/renderer/sidebar/sidebar.ts'],
  bundle: true,
  outdir: 'dist/sidebar',
})

mkdirSync('dist/sidebar', { recursive: true })
cpSync('src/renderer/sidebar/index.html', 'dist/sidebar/index.html')
cpSync('src/renderer/sidebar/sidebar.css', 'dist/sidebar/sidebar.css')
cpSync('src/renderer/sidebar/lexend.woff2', 'dist/sidebar/lexend.woff2')
cpSync('src/renderer/sidebar/calendar.svg', 'dist/sidebar/calendar.svg')
cpSync('src/renderer/sidebar/meet.svg', 'dist/sidebar/meet.svg')
cpSync('src/renderer/sidebar/drive.svg', 'dist/sidebar/drive.svg')
console.log('build ok')
