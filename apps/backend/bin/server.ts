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

const { assertSupportedNodeVersion } = await import('#start/node_version');
assertSupportedNodeVersion();

await import('reflect-metadata');
const { Ignitor, prettyPrintError } = await import('@adonisjs/core/ignitor');
const { createServer } = await import('node:http');
const { configureNodeServer } = await import('#start/resource_limits');

/**
 * URL to the application root. AdonisJS need it to resolve
 * paths to file and directories for scaffolding commands
 */
const APP_ROOT = new URL('../', import.meta.url);

/**
 * The importer is used to import files in context of the
 * application.
 */
const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href);
  }
  return import(filePath);
};

let logConnectionDrop: (entry: Record<string, unknown>) => void = () => {};
let terminateApplication: (() => Promise<void>) | undefined;
type E2eRequestActivity = typeof import('#start/e2e_request_activity').installE2eRequestActivity;
type NodeServer = Parameters<E2eRequestActivity>[0];
type NodeHandler = Parameters<E2eRequestActivity>[1];
let installE2eHarness:
  ((server: NodeServer, handler: NodeHandler) => ReturnType<E2eRequestActivity>) | undefined;
let resetControl: ReturnType<E2eRequestActivity> | undefined;

new Ignitor(APP_ROOT, { importer: IMPORTER })
  .tap((app) => {
    terminateApplication = () => app.terminate();
    app.terminating(async () => {
      await resetControl?.close();
    });
    app.booting(async () => {
      await import('#start/env');
    });
    app.booted(async () => {
      const { default: logger } = await import('@adonisjs/core/services/logger');
      logConnectionDrop = (entry) => logger.warn(entry);

      // The isolated-worker harness is loaded only for a reset-enabled server, so an ordinary
      // start keeps the framework's own request wiring and never evaluates the harness modules.
      const { default: env } = await import('#start/env');
      if (!env.get('CAPACITYLENS_ALLOW_RESET')) return;
      const { installE2eRequestActivity } = await import('#start/e2e_request_activity');
      installE2eHarness = (server, handler) =>
        installE2eRequestActivity(server, handler, {
          token: process.env.CAPACITYLENS_E2E_RESET_TOKEN,
          host: env.get('HOST'),
          port: env.get('PORT'),
        });
    });
    app.listen('SIGTERM', () => app.terminate());
    app.listenIf(app.managedByPm2, 'SIGINT', () => app.terminate());
  })
  .httpServer()
  .start((handler) => {
    if (!installE2eHarness) return configureNodeServer(createServer(handler), logConnectionDrop);
    const server = createServer();
    resetControl = installE2eHarness(server, handler);
    return configureNodeServer(server, logConnectionDrop);
  })
  .then(async () => resetControl?.ready)
  .catch(async (error) => {
    process.exitCode = 1;
    prettyPrintError(error);
    await terminateApplication?.();
  });
