import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { createApp } from "../app";
import type {
  createCompositeAuditSink,
  createFileAuditSink,
  createNoopAuditSink,
  createStreamAuditSink,
  parseAuditConfig,
} from "../audit";
import type { AuditSink } from "../audit";
import type { formatBackupStartupFailure, startBackups } from "../backup";
import { openDb, type Db } from "../db";
import type { createLastResortErrorHandler, createShutdownHandler, handleListenFailure } from "../shutdown";
import type { closeDbSafely, parseAuditMaxMb, refuseToStart } from "./refusals";
import { startServerRuntime } from "./serverRuntime";

const runtime = vi.hoisted(() => ({
  createApp: vi.fn<typeof createApp>(),
  parseAuditConfig: vi.fn<typeof parseAuditConfig>(),
  createFileAuditSink: vi.fn<typeof createFileAuditSink>(),
  createNoopAuditSink: vi.fn<typeof createNoopAuditSink>(),
  createStreamAuditSink: vi.fn<typeof createStreamAuditSink>(),
  createCompositeAuditSink: vi.fn<typeof createCompositeAuditSink>(),
  startBackups: vi.fn<typeof startBackups>(),
  formatBackupStartupFailure: vi.fn<typeof formatBackupStartupFailure>(),
  createShutdownHandler: vi.fn<typeof createShutdownHandler>(),
  createLastResortErrorHandler: vi.fn<typeof createLastResortErrorHandler>(),
  handleListenFailure: vi.fn<typeof handleListenFailure>(),
  closeDbSafely: vi.fn<typeof closeDbSafely>(),
  parseAuditMaxMb: vi.fn<typeof parseAuditMaxMb>(),
  refuseToStart: vi.fn<typeof refuseToStart>(),
}));

vi.mock("../app", () => ({ createApp: runtime.createApp }));
vi.mock("../audit", () => ({
  parseAuditConfig: runtime.parseAuditConfig,
  createFileAuditSink: runtime.createFileAuditSink,
  createNoopAuditSink: runtime.createNoopAuditSink,
  createStreamAuditSink: runtime.createStreamAuditSink,
  createCompositeAuditSink: runtime.createCompositeAuditSink,
}));
vi.mock("../backup", () => ({
  startBackups: runtime.startBackups,
  formatBackupStartupFailure: runtime.formatBackupStartupFailure,
}));
vi.mock("../shutdown", () => ({
  createShutdownHandler: runtime.createShutdownHandler,
  createLastResortErrorHandler: runtime.createLastResortErrorHandler,
  handleListenFailure: runtime.handleListenFailure,
}));
vi.mock("./refusals", () => ({
  closeDbSafely: runtime.closeDbSafely,
  parseAuditMaxMb: runtime.parseAuditMaxMb,
  refuseToStart: runtime.refuseToStart,
}));

const application = {
  applicationId: "capacitylens",
  displayName: "Wayne Enterprises",
  branding: {
    totpIssuer: "CapacityLens",
    passwordContextWords: ["Wayne", "Enterprises"],
    defaultProviderLabel: "Wayne Identity",
  },
};

let app: FastifyInstance;
let db: Db;
let callbacks: Map<string | symbol, (...args: unknown[]) => void>;
let listen: ReturnType<typeof vi.fn<(options: { port: number; host: string }) => Promise<string>>>;
let shutdown: ReturnType<typeof createShutdownHandler>;
let lastResort: ReturnType<typeof createLastResortErrorHandler>;
let disposeStartup: ReturnType<typeof vi.fn<() => void>>;
let startupSignals: { dispose: () => void; requested: () => null };
let logInfo: ReturnType<typeof vi.fn<(message: string) => void>>;
let logWarning: ReturnType<typeof vi.fn<(message: string) => void>>;
let logError: ReturnType<typeof vi.fn<(message: string, error?: unknown) => void>>;
let startupOrder: string[];
let fileSink: AuditSink;
let noopSink: AuditSink;
let streamSink: AuditSink;
let compositeSink: AuditSink;
let backupController: ReturnType<typeof startBackups>;

function createSink(): AuditSink {
  return { append: () => true, appendMany: () => true, degraded: false };
}

beforeEach(() => {
  app = Fastify();
  listen = vi.fn<(options: { port: number; host: string }) => Promise<string>>(async () => {
    startupOrder.push("listen");
    return "http://127.0.0.1:8787";
  });
  Object.defineProperty(app, "listen", { value: listen });
  db = openDb(":memory:");
  callbacks = new Map();
  shutdown = vi.fn<ReturnType<typeof createShutdownHandler>>(async () => {});
  lastResort = vi.fn<ReturnType<typeof createLastResortErrorHandler>>(async () => {});
  startupOrder = [];
  disposeStartup = vi.fn<() => void>(() => void startupOrder.push("startup listeners disposed"));
  startupSignals = { dispose: disposeStartup, requested: () => null };
  logInfo = vi.fn<(message: string) => void>();
  logWarning = vi.fn<(message: string) => void>();
  logError = vi.fn<(message: string, error?: unknown) => void>();
  fileSink = createSink();
  noopSink = createSink();
  streamSink = createSink();
  compositeSink = createSink();
  backupController = {
    health: { degraded: false, lastSuccessAt: "2026-09-09T08:00:00.000Z" },
    snapshotNow: vi.fn(async () => "/snapshots/capacitylens-2026-09-09.sqlite"),
    stop: vi.fn(async () => {}),
  };

  runtime.createApp.mockReturnValue(app);
  runtime.parseAuditConfig.mockReturnValue({ enabled: true, file: "/var/log/capacitylens-audit.jsonl" });
  runtime.createFileAuditSink.mockReturnValue(fileSink);
  runtime.createNoopAuditSink.mockReturnValue(noopSink);
  runtime.createStreamAuditSink.mockReturnValue(streamSink);
  runtime.createCompositeAuditSink.mockReturnValue(compositeSink);
  runtime.parseAuditMaxMb.mockReturnValue(64);
  runtime.startBackups.mockReturnValue(backupController);
  runtime.formatBackupStartupFailure.mockReturnValue("backup startup failed");
  runtime.closeDbSafely.mockImplementation(() => void startupOrder.push("db closed"));
  runtime.createShutdownHandler.mockImplementation(() => {
    startupOrder.push("shutdown created");
    return shutdown;
  });
  runtime.createLastResortErrorHandler.mockReturnValue(lastResort);
});

afterEach(async () => {
  await Promise.resolve();
  await Promise.resolve();
  db.close();
  vi.resetAllMocks();
});

function start(overrides: Partial<Parameters<typeof startServerRuntime>[0]> = {}) {
  const input: Parameters<typeof startServerRuntime>[0] = {
    application,
    applicationOptions: { authMode: "off", allowReset: true },
    backupConfig: null,
    db,
    dbPath: "/var/lib/capacitylens.sqlite",
    environment: {},
    host: "127.0.0.1",
    port: 8787,
    startupSignals,
    securityLog: vi.fn(),
    userCount: 1,
    logEnabled: false,
    logInfo,
    logWarning,
    logError,
    exit: vi.fn(() => {
      throw new Error("exit should not be called directly");
    }),
    onProcessEvent(event, listener) {
      startupOrder.push(`registered ${String(event)}`);
      callbacks.set(event, (...args) => {
        Reflect.apply(listener, process, args);
      });
      return process;
    },
    ...overrides,
  };
  startServerRuntime(input);
  return input;
}

function createdOptions(): NonNullable<Parameters<typeof createApp>[1]> {
  const options = runtime.createApp.mock.calls[0]?.[1];
  if (!options) throw new Error("application was not created");
  return options;
}

describe("startServerRuntime audit and backup composition", () => {
  it("uses the file audit sink when stdout forwarding is disabled", () => {
    start({ environment: { CAPACITYLENS_AUDIT_MAX_MB: "12" } });

    expect(runtime.parseAuditConfig).toHaveBeenCalledWith(
      { CAPACITYLENS_AUDIT_MAX_MB: "12" },
      "/var/lib/capacitylens.sqlite",
    );
    expect(runtime.parseAuditMaxMb).toHaveBeenCalledWith("12");
    expect(runtime.createFileAuditSink).toHaveBeenCalledWith(
      "/var/log/capacitylens-audit.jsonl",
      expect.any(Function),
      { maxBytes: 64 * 1024 * 1024 },
    );
    expect(runtime.createStreamAuditSink).not.toHaveBeenCalled();
    expect(runtime.createCompositeAuditSink).not.toHaveBeenCalled();
    expect(createdOptions().audit).toBe(fileSink);
  });

  it("combines file and stdout audit sinks and starts optional backups with live health", () => {
    const backupConfig = { dir: "/snapshots", intervalMin: 60, keep: 48 };
    start({
      backupConfig,
      environment: { CAPACITYLENS_AUDIT_STDOUT: "1", CAPACITYLENS_AUDIT_MAX_MB: "12" },
    });

    expect(runtime.createCompositeAuditSink).toHaveBeenCalledWith(fileSink, streamSink);
    const options = createdOptions();
    if (!options.backupHealth) throw new Error("backup health was not supplied to the application");
    expect(options).toMatchObject({ application, audit: compositeSink });
    expect(options.backupHealth()).toEqual({ degraded: false, lastSuccessAt: "2026-09-09T08:00:00.000Z" });
    const backupInput = runtime.startBackups.mock.calls[0]?.[0];
    if (!backupInput) throw new Error("backup startup was not requested");
    expect(backupInput.db).toBe(db);
    expect(backupInput.config).toEqual(backupConfig);
    expect(typeof backupInput.log).toBe("function");
  });

  it("uses the noop audit sink when auditing is disabled", () => {
    runtime.parseAuditConfig.mockReturnValue({ enabled: false, file: "/ignored.jsonl" });
    start();

    expect(runtime.createNoopAuditSink).toHaveBeenCalledOnce();
    expect(runtime.createFileAuditSink).not.toHaveBeenCalled();
    expect(runtime.createStreamAuditSink).not.toHaveBeenCalled();
    expect(runtime.createCompositeAuditSink).not.toHaveBeenCalled();
    expect(createdOptions().audit).toBe(noopSink);
  });

  it("does not start backups or supply backup health without a backup configuration", () => {
    start();

    expect(runtime.startBackups).not.toHaveBeenCalled();
    expect(createdOptions().backupHealth).toBeUndefined();
  });
});

describe("startServerRuntime startup and process forwarding", () => {
  it("warns when password setup is locked and forwards a successful listen address", async () => {
    start({ applicationOptions: { authMode: "password", allowReset: false }, userCount: 0 });
    await vi.waitFor(() => expect(logInfo).toHaveBeenCalled());

    expect(listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 8787 });
    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining("SETUP LOCKED"));
    expect(logInfo).toHaveBeenCalledWith(
      "capacitylens-server listening on http://127.0.0.1:8787 (db=/var/lib/capacitylens.sqlite, reset=false)",
    );
  });

  it("does not issue the setup warning outside a locked password installation", () => {
    start({ applicationOptions: { authMode: "off", allowReset: false }, userCount: 0 });
    start({ applicationOptions: { authMode: "password", allowReset: false }, userCount: 1 });

    expect(logWarning).not.toHaveBeenCalled();
  });

  it("forwards listen failures to the shutdown boundary", async () => {
    const failure = new Error("address unavailable");
    listen.mockRejectedValue(failure);
    start();

    await vi.waitFor(() => expect(runtime.handleListenFailure).toHaveBeenCalled());
    expect(runtime.handleListenFailure).toHaveBeenCalledWith(failure, shutdown);
  });
});

describe("startServerRuntime signal and fatal forwarding", () => {
  it("forwards signal and fatal process events through the runtime handlers", async () => {
    const input = start({ backupConfig: { dir: "/snapshots", intervalMin: 60, keep: 48 } });
    callbacks.get("SIGTERM")?.();
    callbacks.get("SIGINT")?.();
    const crash = new Error("crash");
    callbacks.get("uncaughtException")?.(crash);
    callbacks.get("unhandledRejection")?.("rejected");

    expect(startupOrder).toEqual([
      "shutdown created",
      "startup listeners disposed",
      "registered SIGTERM",
      "registered SIGINT",
      "registered uncaughtException",
      "registered unhandledRejection",
      "listen",
    ]);
    expect(logInfo).toHaveBeenNthCalledWith(1, "capacitylens-server: SIGTERM — draining requests, then exiting");
    expect(logInfo).toHaveBeenNthCalledWith(2, "capacitylens-server: SIGINT — draining requests, then exiting");
    expect(shutdown).toHaveBeenNthCalledWith(1, 0, "signal:SIGTERM");
    expect(shutdown).toHaveBeenNthCalledWith(2, 0, "signal:SIGINT");
    expect(lastResort).toHaveBeenNthCalledWith(1, "uncaught_exception", crash);
    expect(lastResort).toHaveBeenNthCalledWith(2, "unhandled_rejection", "rejected");
    const shutdownInput = runtime.createShutdownHandler.mock.calls[0]?.[0];
    if (!shutdownInput?.stopBackgroundWork) throw new Error("shutdown was not configured for backup cleanup");
    expect(shutdownInput.app).toBe(app);
    expect(shutdownInput.db).toBe(db);
    expect(shutdownInput.exit).toBe(input.exit);
    await shutdownInput.stopBackgroundWork();
    expect(backupController.stop).toHaveBeenCalledOnce();
    const lastResortInput = runtime.createLastResortErrorHandler.mock.calls[0];
    if (!lastResortInput) throw new Error("last-resort handler was not created");
    expect(lastResortInput[0]).toBe(shutdown);
    expect(lastResortInput[1]).toBe(input.securityLog);
    const fatalError = new Error("fatal detail");
    lastResortInput[2]("fatal message", fatalError);
    expect(logError).toHaveBeenLastCalledWith("fatal message", fatalError);
    const backupInput = runtime.startBackups.mock.calls[0]?.[0];
    if (!backupInput?.log) throw new Error("backup startup was not requested with a log adapter");
    backupInput.log("snapshot complete");
    expect(logInfo).toHaveBeenLastCalledWith("snapshot complete");
  });
});

describe("startServerRuntime startup failures", () => {
  it("closes the database and disposes startup listeners when app construction fails", () => {
    const failure = new Error("app failed");
    runtime.createApp.mockImplementation(() => {
      throw failure;
    });
    runtime.refuseToStart.mockImplementation(() => {
      startupOrder.push("refused");
      throw failure;
    });

    expect(() => start()).toThrow(failure);
    expect(runtime.closeDbSafely).toHaveBeenCalledWith(db);
    expect(startupOrder).toEqual(["db closed", "startup listeners disposed", "refused"]);
    expect(runtime.refuseToStart).toHaveBeenCalledWith("app failed");
    expect(callbacks.size).toBe(0);
    expect(listen).not.toHaveBeenCalled();
  });

  it("cleans up and frames a backup startup failure after app creation", () => {
    const failure = new Error("permissions denied");
    runtime.startBackups.mockImplementation(() => {
      throw failure;
    });
    runtime.refuseToStart.mockImplementation(() => {
      startupOrder.push("refused");
      throw failure;
    });
    const backupConfig = { dir: "/snapshots", intervalMin: 60, keep: 48 };

    expect(() => start({ backupConfig })).toThrow(failure);
    expect(runtime.closeDbSafely).toHaveBeenCalledWith(db);
    expect(startupOrder).toEqual(["db closed", "startup listeners disposed", "refused"]);
    expect(runtime.formatBackupStartupFailure).toHaveBeenCalledWith("/snapshots", failure);
    expect(runtime.refuseToStart).toHaveBeenCalledWith("backup startup failed");
    expect(callbacks.size).toBe(0);
    expect(listen).not.toHaveBeenCalled();
  });
});
