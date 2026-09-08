import type { BoundApplication } from "@capacitylens/shared/account/types";
import type { FastifyInstance } from "fastify";

import type { AppOptions } from "../app";
import { createApp } from "../app";
import {
  createCompositeAuditSink,
  createFileAuditSink,
  createNoopAuditSink,
  createStreamAuditSink,
  parseAuditConfig,
} from "../audit";
import type { BackupConfig } from "../backup";
import { formatBackupStartupFailure, startBackups } from "../backup";
import type { Db } from "../db";
import { createLastResortErrorHandler, createShutdownHandler, handleListenFailure } from "../shutdown";
import type { StartupSignalController } from "../startupSignals";
import { closeDbSafely, parseAuditMaxMb, refuseToStart } from "./refusals";

type BackupController = ReturnType<typeof startBackups>;
type SecurityLog = (event: Record<string, unknown>) => void;

export interface ServerRuntimeInput {
  application: BoundApplication;
  applicationOptions: Omit<AppOptions, "application" | "audit" | "backupHealth" | "securityLog">;
  backupConfig: BackupConfig | null;
  db: Db;
  dbPath: string;
  environment: NodeJS.ProcessEnv;
  host: string;
  port: number;
  startupSignals: StartupSignalController;
  securityLog: SecurityLog;
  userCount: number;
  logEnabled: boolean;
  logInfo: (message: string) => void;
  logWarning: (message: string) => void;
  logError: (message: string, error?: unknown) => void;
  exit: (code: number) => never;
  onProcessEvent: NodeJS.Process["on"];
}

function createConfiguredAuditSink(input: ServerRuntimeInput) {
  const auditConfig = parseAuditConfig(input.environment, input.dbPath);
  const auditMaxBytes = parseAuditMaxMb(input.environment.CAPACITYLENS_AUDIT_MAX_MB) * 1024 * 1024;
  const auditFileSink = auditConfig.enabled
    ? createFileAuditSink(auditConfig.file, (message) => input.logError(message), { maxBytes: auditMaxBytes })
    : createNoopAuditSink();

  return input.environment.CAPACITYLENS_AUDIT_STDOUT === "1"
    ? createCompositeAuditSink(auditFileSink, createStreamAuditSink(input.logInfo))
    : auditFileSink;
}

function formatApplicationStartupFailure(
  error: unknown,
  startingBackups: boolean,
  backupConfig: BackupConfig | null,
): string {
  if (startingBackups && backupConfig) return formatBackupStartupFailure(backupConfig.dir, error);
  return error instanceof Error ? error.message : String(error);
}

function createServerApplication(input: ServerRuntimeInput): {
  app: FastifyInstance;
  backups: BackupController | null;
} {
  let startingBackups = false;
  try {
    // A successful explicit admin bootstrap makes the captured count nonzero and skips this notice.
    if (input.applicationOptions.authMode === "password" && input.userCount === 0) {
      input.logWarning(
        "capacitylens-server: SETUP LOCKED — no user accounts exist yet; owner creation requires the " +
          "configured SMALLSASS_ACCOUNT_SETUP_TOKEN.",
      );
    }
    let backupController: BackupController | null = null;
    const app = createApp(input.db, {
      ...input.applicationOptions,
      application: input.application,
      audit: createConfiguredAuditSink(input),
      securityLog: input.securityLog,
      ...(input.backupConfig
        ? {
            backupHealth: () =>
              backupController?.health ?? {
                degraded: false,
                lastSuccessAt: null,
              },
          }
        : {}),
    });

    if (input.backupConfig) {
      startingBackups = true;
      backupController = startBackups({
        db: input.db,
        config: input.backupConfig,
        log: input.logEnabled ? (message) => app.log.info(message) : input.logInfo,
      });
      startingBackups = false;
    }
    return { app, backups: backupController };
  } catch (error) {
    closeDbSafely(input.db);
    input.startupSignals.dispose();
    refuseToStart(formatApplicationStartupFailure(error, startingBackups, input.backupConfig));
  }
}

function createRuntimeShutdown(
  input: ServerRuntimeInput,
  app: FastifyInstance,
  backups: BackupController | null,
): ReturnType<typeof createShutdownHandler> {
  const shutdown = createShutdownHandler({
    app,
    db: input.db,
    exit: input.exit,
    stopBackgroundWork: backups ? () => backups.stop() : undefined,
  });
  const onSignal = (signal: NodeJS.Signals) => {
    input.logInfo(`capacitylens-server: ${signal} — draining requests, then exiting`);
    void shutdown(0, `signal:${signal}`);
  };
  // There is no event-loop turn between removing the startup listeners and installing these
  // handlers, so a queued signal is observed by one phase or the other, never by neither.
  input.startupSignals.dispose();
  input.onProcessEvent("SIGTERM", () => onSignal("SIGTERM"));
  input.onProcessEvent("SIGINT", () => onSignal("SIGINT"));

  const lastResort = createLastResortErrorHandler(shutdown, input.securityLog, (message, error) =>
    input.logError(message, error),
  );
  input.onProcessEvent("uncaughtException", (error) => void lastResort("uncaught_exception", error));
  input.onProcessEvent("unhandledRejection", (reason) => void lastResort("unhandled_rejection", reason));
  return shutdown;
}

/** Creates the post-migration server runtime and starts accepting requests. */
export function createServerRuntime(input: ServerRuntimeInput): void {
  const { app, backups } = createServerApplication(input);
  const shutdown = createRuntimeShutdown(input, app, backups);
  app
    .listen({ port: input.port, host: input.host })
    .then((address) =>
      input.logInfo(
        `capacitylens-server listening on ${address} (db=${input.dbPath}, reset=${input.applicationOptions.allowReset})`,
      ),
    )
    .catch((error) => void handleListenFailure(error, shutdown));
}
