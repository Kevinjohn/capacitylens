import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { fileURLToPath } from 'node:url'
import { parsePort } from '../../scripts/dev/parsePort.mjs'
import { ports, testShare } from '../../tooling/ports.mjs'
import { ENTRY_RAW_LIMIT_KB } from '../../scripts/build/bundleBudget.mjs'
import { isAccountEmail } from '../../packages/shared/src/account/validation.ts'

// Port lane-derived ports keep concurrent worktrees on disjoint service endpoints.
const portLanePorts = ports()
const devApiPort = parsePort(
  process.env.CAPACITYLENS_DEV_API_PORT,
  portLanePorts.dbApi,
  'CAPACITYLENS_DEV_API_PORT'
)
// One Vite config serves several dev servers on different ports (the core app, and the db/auth
// flavours Playwright boots). The service name selects which port lane port this invocation binds,
// so no script has to pass a literal `--port`.
const viteService = process.env.CAPACITYLENS_VITE_SERVICE ?? 'web'
if (!Object.hasOwn(portLanePorts, viteService)) {
  throw new Error(
    `CAPACITYLENS_VITE_SERVICE must name a port lane port; received ${JSON.stringify(viteService)}.`
  )
}
const servicePort = portLanePorts[viteService as keyof typeof portLanePorts]

/** Configures application builds and port-lane-local development, refusing invalid client deployment settings. */
export default defineConfig(({ mode }) => {
  // Scripts load this config from the repository root, so resolve frontend paths from the config file.
  const frontendRoot = fileURLToPath(new URL('.', import.meta.url))
  const fileEnv = loadEnv(mode, frontendRoot, 'VITE_CAPACITYLENS_')
  const clientEnv = (name: 'VITE_CAPACITYLENS_FEEDBACK_MAILTO') =>
    process.env[name] ?? fileEnv[name] ?? ''
  const feedbackAddress = clientEnv('VITE_CAPACITYLENS_FEEDBACK_MAILTO').trim()
  if (feedbackAddress !== '' && !isAccountEmail(feedbackAddress)) {
    throw new Error('VITE_CAPACITYLENS_FEEDBACK_MAILTO must be one valid email address.')
  }

  return {
    root: frontendRoot,
    build: {
      outDir: '../../dist',
      emptyOutDir: true,
      // The post-build checker also enforces the gzip limit. Sharing its raw boundary keeps Vite's
      // generic chunk warning actionable instead of warning below the project's deliberate budget.
      chunkSizeWarningLimit: ENTRY_RAW_LIMIT_KB,
    },
    plugins: [
      react(),
      tailwindcss(),
      // Paraglide generates messages from committed sources during dev and builds. Package scripts
      // precompile them so direct type-check and Vitest commands can resolve the output. The
      // company-scoped locale stays client-only in a global variable; baseLocale keeps English as
      // the fallback without a page reload or server round-trip.
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/paraglide',
        outputStructure: 'locale-modules',
        strategy: ['globalVariable', 'baseLocale'],
      }),
    ],
    resolve: {
      alias: {
        '@capacitylens/shared': fileURLToPath(
          new URL('../../packages/shared/src', import.meta.url)
        ),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Bind IPv4 loopback so clients using 127.0.0.1 can reach the server regardless of localhost address ordering.
    // Refuse occupied ports so the launcher and browser retain the same endpoint.
    server: {
      host: '127.0.0.1',
      port: servicePort,
      strictPort: true,
      // The dev proxy and full-stack launcher share the configured port lane API port so browser requests stay same-origin.
      proxy: {
        '/api': {
          // Keep this `CAPACITYLENS_DEV_API_PORT ?? port lane dbApi` default identical to
          // scripts/dev/dev-fullstack.mjs's API_PORT so the launcher and this proxy stay in lockstep.
          target: `http://localhost:${devApiPort}`,
          changeOrigin: true,
        },
        '/health': {
          target: `http://localhost:${devApiPort}`,
          changeOrigin: true,
        },
      },
    },
    // `vite preview` and scripts/e2e/serve-dist.mjs both default to 4173, so this needs a port lane too.
    preview: {
      host: '127.0.0.1',
      port: portLanePorts.preview,
      strictPort: true,
    },
    test: {
      // Without a reserved share, use the same half-core ceiling as a solo port lane claim.
      maxWorkers: testShare(),
      environment: 'jsdom',
      env: { TZ: 'UTC' },
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      include: ['src/**/*.{test,spec}.{ts,tsx}', '../../packages/shared/**/*.{test,spec}.ts'],
      // The docs lightbox test reads the built site in docs/, which is not committed; it runs
      // after `pnpm run docs:build` through `pnpm run docs:test`.
      exclude: [
        'e2e/**',
        'node_modules/**',
        'dist/**',
        ...(process.env.CAPACITYLENS_DOCS_SITE_TESTS === '1'
          ? []
          : ['src/test/docs-lightbox.test.ts']),
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}', '../../packages/shared/src/**/*.ts'],
        exclude: [
          '**/*.test.{ts,tsx}',
          'src/test/**',
          'src/main.tsx',
          'src/router.tsx',
          'src/vite-env.d.ts',
          // Paraglide generates this message runtime from committed sources, so coverage excludes it.
          'src/paraglide/**',
        ],
      },
    },
  }
})
