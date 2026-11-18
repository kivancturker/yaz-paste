import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * The renderer ships with a strict Content-Security-Policy (see src/renderer/index.html).
 * In dev, React Fast Refresh injects an inline script, so only the dev server relaxes it.
 */
function devCsp(): Plugin {
  return {
    name: 'yaz-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), devCsp()],
    worker: { format: 'es' }
  }
})
