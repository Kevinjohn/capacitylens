/*
|--------------------------------------------------------------------------
| HTTP server entrypoint
|--------------------------------------------------------------------------
|
| The "server.ts" file is the entrypoint for starting the AdonisJS HTTP
| server. Either you can run this file directly or use the "serve"
| command to run this file and monitor file changes
|
*/

import type { IncomingMessage, Server, ServerResponse } from 'node:http'
const { assertSupportedNodeVersion } = await import('#bin/node_version')
assertSupportedNodeVersion()
const { failUnsettledStart } = await import('#bin/unsettled_start')

await import('reflect-metadata')
const { Ignitor, prettyPrintError } = await import('@adonisjs/core/ignitor')
const { createServer } = await import('node:http')
const { configureNodeServer } = await import('#start/resource_limits')

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

let logConnectionDrop: (entry: Record<string, unknown>) => void = () => {}
let terminateApplication: (() => Promise<void>) | undefined
// The reset harness lives in the repository's development tooling, outside the backend's source
// root, so its signature is restated here rather than imported.
type E2eRequestActivity = (
  server: Server,
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
) => void
let installE2eHarness: E2eRequestActivity | undefined

const start = new Ignitor(APP_ROOT, { importer: IMPORTER })
  .tap((app) => {
    terminateApplication = () => app.terminate()
    app.booting(async () => {
      await import('#start/env')
    })
    app.booted(async () => {
      const { default: logger } = await import('@adonisjs/core/services/logger')
      logConnectionDrop = (entry) => logger.warn(entry)

      // The isolated-worker harness is loaded only for a reset-enabled server, so an ordinary
      // start keeps the framework's own request wiring and never evaluates the harness modules.
      const { default: capacitylens } = await import('#config/capacitylens')
      if (!capacitylens.allowReset) return
      const { installE2eRequestActivity } =
        (await import('@capacitylens/tooling/e2e_request_activity')) as {
          installE2eRequestActivity: E2eRequestActivity
        }
      installE2eHarness = installE2eRequestActivity
    })
    app.listen('SIGTERM', () => app.terminate())
    app.listenIf(app.managedByPm2, 'SIGINT', () => app.terminate())
  })
  .httpServer()
  .start((handler) => {
    if (!installE2eHarness) return configureNodeServer(createServer(handler), logConnectionDrop)
    const server = createServer()
    installE2eHarness(server, handler)
    return configureNodeServer(server, logConnectionDrop)
  })
  .catch(async (error) => {
    process.exitCode = 1
    prettyPrintError(error)
    await terminateApplication?.()
  })
void failUnsettledStart(start, 'The server')
