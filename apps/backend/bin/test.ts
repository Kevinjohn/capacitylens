/*
|--------------------------------------------------------------------------
| Test runner entrypoint
|--------------------------------------------------------------------------
|
| The "test.ts" file is the entrypoint for running tests using Japa.
|
| Either you can run this file directly or use the "test"
| command to run this file and monitor file changes.
|
*/

process.env.NODE_ENV = 'test'

import { fileURLToPath } from 'node:url'
import { ports } from '../../../scripts/ports.mjs'

const testHttpPort = ports().testHttp
Object.assign(process.env, {
  HOST: '127.0.0.1',
  PORT: String(testHttpPort),
  LOG_LEVEL: 'error',
  APP_KEY: 'capacitylens-test-key-0123456789abcdef',
  APP_URL: `http://127.0.0.1:${testHttpPort}`,
  SESSION_DRIVER: 'database',
  CAPACITYLENS_MODE: 'password-only',
  CAPACITYLENS_SECRET: 'capacitylens-test-secret-0123456789abcdef',
  CAPACITYLENS_PUBLIC_URL: `http://127.0.0.1:${testHttpPort}`,
  CAPACITYLENS_SETUP_TOKEN: 'capacitylens-japa-setup-token-0123456789abcdef',
  CAPACITYLENS_PASSWORD_BREACH_CHECK: 'false',
  CAPACITYLENS_RATE_LIMIT: '10000',
  CAPACITYLENS_ALLOW_RESET: 'true',
  CAPACITYLENS_TEST_HTTP_PORT: String(testHttpPort),
  CAPACITYLENS_DB: fileURLToPath(new URL(`../tmp/japa-${testHttpPort}.db`, import.meta.url)),
})

import 'reflect-metadata'
import { Ignitor, prettyPrintError } from '@adonisjs/core/ignitor'
import { configure, processCLIArgs, run } from '@japa/runner'

/**
 * URL to the application root. AdonisJS need it to resolve
 * paths to file and directories for scaffolding commands
 */
const APP_ROOT = new URL('../', import.meta.url)

/**
 * The importer is used to import files in context of the
 * application.
 */
const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href)
  }
  return import(filePath)
}

new Ignitor(APP_ROOT, { importer: IMPORTER })
  .tap((app) => {
    app.booting(async () => {
      await import('#start/env')
    })
    app.listen('SIGTERM', () => app.terminate())
    app.listenIf(app.managedByPm2, 'SIGINT', () => app.terminate())
  })
  .testRunner()
  .configure(async (app) => {
    const { runnerHooks, ...config } = await import('../tests/bootstrap.js')

    processCLIArgs(process.argv.splice(2))
    configure({
      ...app.rcFile.tests,
      ...config,
      ...{
        setup: runnerHooks.setup,
        teardown: runnerHooks.teardown.concat([() => app.terminate()]),
      },
    })
  })
  .run(() => run())
  .catch((error) => {
    process.exitCode = 1
    prettyPrintError(error)
  })
