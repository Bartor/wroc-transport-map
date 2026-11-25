import { rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Files the public build does not ship: survey.json, the 1174 addresses where
// interviewers started their rounds.
const PRIVATE = ['data/survey.json']

/** `vite build --mode public` produces the site for GitHub Pages. */
function publicBuild() {
  return {
    name: 'public-build',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist')
      for (const f of PRIVATE) rmSync(resolve(out, f), { force: true })
      // GitHub Pages runs Jekyll by default, which would drop any _-prefixed path
      writeFileSync(resolve(out, '.nojekyll'), '')
    },
  }
}

export default defineConfig(({ mode }) => ({
  // Relative paths, so the site works under any /<repo>/ prefix on Pages.
  base: './',
  plugins: [react(), ...(mode === 'public' ? [publicBuild()] : [])],
  server: { port: 5173, open: true },
  build: {
    rollupOptions: {
      output: {
        // libraries change less often than the app, so they cache apart
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\/](react|react-dom|scheduler)[\/]/.test(id)) return 'react'
          if (/[\/](leaflet|react-leaflet|@react-leaflet)[\/]/.test(id)) return 'leaflet'
          return undefined   // the charts stay with the panel that uses them
        },
      },
    },
  },
}))
