import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../db";
import { startServerRuntime } from "./serverRuntime";

const runtime = vi.hoisted(() => ({
  createApp: vi.fn<(db: Db, options: { backupHealth?: () => unknown }) => FastifyInstance>(),
  parseAuditConfig: vi.fn(),
  createFileAuditSink: vi.fn(),
  createNoopAuditSink: vi.fn(),
  createStreamAuditSink: vi.fn(),
  createCompositeAuditSink: vi.fn(),
  startBackups: vi.fn<
    (input: { db: Db; config: { dir: string; intervalMin: number; keep: number }; log: (message: string) => void }) => {
      health: { degraded: boolean; lastSuccessAt: string | null };
      stop: () => Promise<void>;
    }
  >(),
  formatBackupStartupFailure: vi.fn(),
  createShutdownHandler: vi.fn(),
  createLastResortErrorHandler: vi.fn(),
  handleListenFailure: vi.fn(),
  closeDbSafely: vi.fn(),
  parseAuditMaxMb: vi.fn(),
  refuseToStart: vi.fn(),
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
let shutdown: ReturnType<typeof vi.fn<() => Promise<void>>>;
let lastResort: ReturnType<typeof vi.fn<(kind: string, reason: unknown) => Promise<void>>>;
let disposeStartup: ReturnType<typeof vi.fn<() => void>>;
let startupSignals: { dispose: () => void; requested: () => null };
let logInfo: ReturnType<typeof vi.fn<(message: string) => void>>;
let logWarning: ReturnType<typeof vi.fn<(message: string) => void>>;
let logError: ReturnType<typeof vi.fn<(message: string, error?: unknown) => void>>;
let startupOrder: string[];

beforeEach(() => {
  app = Fastify();
  db = openDb(":memory:");
  callbacks = new Map();
  shutdown = vi.fn<() => Promise<void>>(async () => {});
  lastResort = vi.fn<(kind: string, reason: unknown) => Promise<void>>(async () => {});
  startupOrder = [];
  disposeStartup = vi.fn<() => void>(() => void startupOrder.push("startup listeners disposed"));
  startupSignals = { dispose: disposeStartup, requested: () => null };
  logInfo = vi.fn<(message: string) => void>();
  logWarning = vi.fn<(message: string) => void>();
  logError = vi.fn<(message: string, error?: unknown) => void>();

  runtime.createApp.mockReturnValue(app);
  runtime.parseAuditConfig.mockReturnValue({ enabled: true, file: "/var/log/capacitylens-audit.jsonl" });
  runtime.createFileAuditSink.mockReturnValue("file-sink");
  runtime.createNoopAuditSink.mockReturnValue("noop-sink");
  runtime.createStreamAuditSink.mockReturnValue("stream-sink");
  runtime.createCompositeAuditSink.mockReturnValue("composite-sink");
  runtime.parseAuditMaxMb.mockReturnValue(64);
  runtime.startBackups.mockReturnValue({
    health: { degraded: false, lastSuccessAt: "2026-09-09T08:00:00.000Z" },
    stop: vi.fn(async () => {}),
  });
  runtime.formatBackupStartupFailure.mockReturnValue("backup startup failed");
  runtime.createShutdownHandler.mockImplementation(() => {
    startupOrder.push("shutdown created");
    return shutdown;
  });
  runtime.createLastResortErrorHandler.mockReturnValue(lastResort);
});

afterEach(() => {
  db.close();
  vi.clearAllMocks();
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

describe("startServerRuntime audit and backup composition", () => {
  it("configures the selected audit sink, starts optional backups, and exposes their health", () => {
    const backupConfig = { dir: "/snapshots", intervalMin: 60, keep: 48 };
    start({
      backupConfig,
      environment: { CAPACITYLENS_AUDIT_STDOUT: "1", CAPACITYLENS_AUDIT_MAX_MB: "12" },
    });

    expect(runtime.createFileAuditSink).toHaveBeenCalledWith(
      "/var/log/capacitylens-audit.jsonl",
      expect.any(Function),
      { maxBytes: 64 * 1024 * 1024 },
    );
    expect(runtime.createCompositeAuditSink).toHaveBeenCalledWith("file-sink", "stream-sink");
    const options = runtime.createApp.mock.calls[0]?.[1];
    if (!options?.backupHealth) throw new Error("backup health was not supplied to the application");
    expect(options).toMatchObject({ application, audit: "composite-sink" });
    expect(options.backupHealth()).toEqual({ degraded: false, lastSuccessAt: "2026-09-09T08:00:00.000Z" });
    const backupInput = runtime.startBackups.mock.calls[0]?.[0];
    if (!backupInput) throw new Error("backup startup was not requested");
    expect(backupInput.db).toBe(db);
    expect(backupInput.config).toEqual(backupConfig);
    expect(typeof backupInput.log).toBe("function");
  });
});

describe("startServerRuntime startup and process forwarding", () => {
  it("warns when password setup is locked and forwards a successful listen address", async () => {
    Object.defineProperty(app, "listen", { value: () => Promise.resolve("http://127.0.0.1:8787") });
    start({ applicationOptions: { authMode: "password", allowReset: false }, userCount: 0 });
    await vi.waitFor(() => expect(logInfo).toHaveBeenCalled());

    expect(logWarning).toHaveBeenCalledWith(expect.stringContaining("SETUP LOCKED"));
    expect(logInfo).toHaveBeenCalledWith(
      "capacitylens-server listening on http://127.0.0.1:8787 (db=/var/lib/capacitylens.sqlite, reset=false)",
    );
  });

  it("forwards listen failures to the shutdown boundary", async () => {
    const failure = new Error("address unavailable");
    vi.spyOn(app, "listen").mockRejectedValue(failure);
    start();

    await vi.waitFor(() => expect(runtime.handleListenFailure).toHaveBeenCalled());
    expect(runtime.handleListenFailure).toHaveBeenCalledWith(failure, shutdown);
  });

  it("forwards signal and fatal process events through the runtime handlers", async () => {
    start();
    callbacks.get("SIGTERM")?.();
    callbacks.get("SIGINT")?.();
    const crash = new Error("crash");
    callbacks.get("uncaughtException")?.(crash);
    callbacks.get("unhandledRejection")?.("rejected");

    expect(startupOrder).toEqual(["shutdown created", "startup listeners disposed"]);
    expect(logInfo).toHaveBeenNthCalledWith(1, "capacitylens-server: SIGTERM — draining requests, then exiting");
    expect(logInfo).toHaveBeenNthCalledWith(2, "capacitylens-server: SIGINT — draining requests, then exiting");
    expect(shutdown).toHaveBeenNthCalledWith(1, 0, "signal:SIGTERM");
    expect(shutdown).toHaveBeenNthCalledWith(2, 0, "signal:SIGINT");
    expect(lastResort).toHaveBeenNthCalledWith(1, "uncaught_exception", crash);
    expect(lastResort).toHaveBeenNthCalledWith(2, "unhandled_rejection", "rejected");
  });
});

describe("startServerRuntime startup failures", () => {
  it("closes the database and disposes startup listeners when app construction fails", () => {
    const failure = new Error("app failed");
    runtime.createApp.mockImplementation(() => {
      throw failure;
    });
    runtime.refuseToStart.mockImplementation(() => {
      throw failure;
    });

    expect(() => start()).toThrow(failure);
    expect(runtime.closeDbSafely).toHaveBeenCalledWith(db);
    expect(disposeStartup).toHaveBeenCalledBefore(runtime.refuseToStart);
    expect(runtime.refuseToStart).toHaveBeenCalledWith("app failed");
  });

  it("cleans up and frames a backup startup failure after app creation", () => {
    const failure = new Error("permissions denied");
    runtime.startBackups.mockImplementation(() => {
      throw failure;
    });
    runtime.refuseToStart.mockImplementation(() => {
      throw failure;
    });
    const backupConfig = { dir: "/snapshots", intervalMin: 60, keep: 48 };

    expect(() => start({ backupConfig })).toThrow(failure);
    expect(runtime.closeDbSafely).toHaveBeenCalledWith(db);
    expect(disposeStartup).toHaveBeenCalledBefore(runtime.refuseToStart);
    expect(runtime.formatBackupStartupFailure).toHaveBeenCalledWith("/snapshots", failure);
    expect(runtime.refuseToStart).toHaveBeenCalledWith("backup startup failed");
  });
});
