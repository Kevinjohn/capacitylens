import { defineConfig } from '@adonisjs/static'

export default defineConfig({
  enabled: true,
  etag: true,
  lastModified: true,
  dotFiles: 'ignore',
  headers(path) {
    return {
      'Cache-Control': path.includes('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-store',
    }
  },
})
