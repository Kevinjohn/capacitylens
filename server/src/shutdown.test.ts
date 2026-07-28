import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_SHUTDOWN_DEADLINE_MS,
  createLastResortErrorHandler,
  createShutdownHandler,
  handleListenFailure,
} from "./shutdown";

// P1.2: the shutdown path must drain Fastify BEFORE closing the DB (a request still
// in flight after db.close() would die mid-transaction — the exact bug this fixes),
// and a second signal must force-exit rather than wait on a stuck drain.

describe("createShutdownHandler", () => {
  it("drains background work after a fatal listen failure", async () => {
    const order: string[] = [];
    const shutdown = createShutdownHandler(
      { close: async () => void order.push("app.close") },
      { close: () => void order.push("db.close") },
      (code) => void order.push(`exit ${code}`),
      async () => void order.push("backups.stop"),
    );
    const listenError = new Error("EADDRINUSE");

    await handleListenFailure(
      listenError,
      shutdown,
      (error) => void order.push(`log ${(error as Error).message}`),
    );

    expect(order).toEqual([
      "log EADDRINUSE",
      "backups.stop",
      "app.close",
      "db.close",
      "exit 1",
    ]);
  });

  it("closes the app (drain) before the db, then exits 0", async () => {
    const order: string[] = [];
    const handler = createShutdownHandler(
      { close: async () => void order.push("app.close") },
      { close: () => void order.push("db.close") },
      (code) => void order.push(`exit ${code}`),
    );
    await handler();
    expect(order).toEqual(["app.close", "db.close", "exit 0"]);
  });

  it("a second signal while draining force-exits 1 without touching the db", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let releaseDrain!: () => void;
    const drain = new Promise<void>((resolve) => (releaseDrain = resolve));
    const order: string[] = [];
    const handler = createShutdownHandler(
      { close: () => drain.then(() => void order.push("app.close")) },
      { close: () => void order.push("db.close") },
      (code) => void order.push(`exit ${code}`),
    );
    const first = handler();
    await handler(0, "signal:SIGTERM"); // second signal arrives mid-drain
    expect(order).toEqual(["exit 1"]); // forced out; db.close must not have run yet
    expect(error).toHaveBeenCalledWith(
      "capacitylens-server: shutdown re-entered during drain (reason=signal:SIGTERM); forcing exit",
    );
    releaseDrain();
    await first; // (a real exit(1) would have terminated; the fake lets the drain finish)
    expect(order).toEqual(["exit 1", "app.close", "db.close", "exit 0"]);
    error.mockRestore();
  });

  it("force-exits within the deadline when the request drain never settles", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.fn();
    const dbClose = vi.fn();
    const handler = createShutdownHandler(
      { close: () => new Promise(() => {}) },
      { close: dbClose },
      exit,
    );

    void handler();
    await vi.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_DEADLINE_MS);

    expect(exit).toHaveBeenCalledWith(1);
    expect(dbClose).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      `capacitylens-server: shutdown exceeded ${DEFAULT_SHUTDOWN_DEADLINE_MS}ms; forcing exit`,
    );
    error.mockRestore();
    vi.useRealTimers();
  });

  it("still closes the db and exits 1 when the request drain throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    const handler = createShutdownHandler(
      {
        close: async () => {
          order.push("app.close");
          throw new Error("boom");
        },
      },
      { close: () => void order.push("db.close") },
      (code) => void order.push(`exit ${code}`),
    );
    await handler();
    expect(order).toEqual(["app.close", "db.close", "exit 1"]);
    expect(error).toHaveBeenCalledWith(
      "capacitylens-server: shutdown request drain failed",
      expect.objectContaining({ message: "boom" }),
    );
    error.mockRestore();
  });

  it("drains requests and closes the db after background-work stop fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    const handler = createShutdownHandler(
      { close: async () => void order.push("app.close") },
      { close: () => void order.push("db.close") },
      (code) => void order.push(`exit ${code}`),
      async () => {
        order.push("backups.stop");
        throw new Error("snapshot failed");
      },
    );

    await handler();

    expect(order).toEqual(["backups.stop", "app.close", "db.close", "exit 1"]);
    expect(error).toHaveBeenCalledWith(
      "capacitylens-server: shutdown background-work stop failed",
      expect.objectContaining({ message: "snapshot failed" }),
    );
    error.mockRestore();
  });

  it("starts the request drain while background work stops and keeps the db open for both", async () => {
    let releaseBackground!: () => void;
    let releaseRequestDrain!: () => void;
    let reportBackgroundFinished!: () => void;
    const backgroundHeld = new Promise<void>(
      (resolve) => (releaseBackground = resolve),
    );
    const requestDrainHeld = new Promise<void>(
      (resolve) => (releaseRequestDrain = resolve),
    );
    const backgroundFinished = new Promise<void>(
      (resolve) => (reportBackgroundFinished = resolve),
    );
    const order: string[] = [];
    const handler = createShutdownHandler(
      {
        close: async () => {
          order.push("app.close started");
          await requestDrainHeld;
          order.push("app.close finished");
        },
      },
      { close: () => void order.push("db.close") },
      (code) => void order.push(`exit ${code}`),
      async () => {
        order.push("backups.stop started");
        await backgroundHeld;
        order.push("backups.stop finished");
        reportBackgroundFinished();
      },
    );

    const pending = handler();
    expect(order).toEqual(["backups.stop started", "app.close started"]);

    releaseBackground();
    await backgroundFinished;
    expect(order).toEqual([
      "backups.stop started",
      "app.close started",
      "backups.stop finished",
    ]);

    releaseRequestDrain();
    await pending;
    expect(order).toEqual([
      "backups.stop started",
      "app.close started",
      "backups.stop finished",
      "app.close finished",
      "db.close",
      "exit 0",
    ]);
  });

  it("reports every cleanup failure after attempting every stage", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    const handler = createShutdownHandler(
      {
        close: async () => {
          order.push("app.close");
          throw new Error("drain failed");
        },
      },
      {
        close: () => {
          order.push("db.close");
          throw new Error("close failed");
        },
      },
      (code) => void order.push(`exit ${code}`),
      async () => {
        order.push("backups.stop");
        throw new Error("stop failed");
      },
    );

    await handler();

    expect(order).toEqual(["backups.stop", "app.close", "db.close", "exit 1"]);
    expect(error.mock.calls.map(([message]) => message)).toEqual([
      "capacitylens-server: shutdown background-work stop failed",
      "capacitylens-server: shutdown request drain failed",
      "capacitylens-server: shutdown database close failed",
    ]);
    error.mockRestore();
  });

  it("preserves a non-zero exit code after an orderly fatal drain", async () => {
    const order: string[] = [];
    const handler = createShutdownHandler(
      { close: async () => void order.push("app.close") },
      { close: () => void order.push("db.close") },
      (code) => void order.push(`exit ${code}`),
    );
    await handler(1);
    expect(order).toEqual(["app.close", "db.close", "exit 1"]);
  });
});

describe("createLastResortErrorHandler", () => {
  it("identifies a process failure that force-exits an in-progress signal drain", async () => {
    let releaseDrain!: () => void;
    const drain = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi.fn();
    const shutdown = createShutdownHandler(
      { close: () => drain },
      { close: vi.fn() },
      exit,
    );
    const first = shutdown(0, "signal:SIGTERM");
    const lastResort = createLastResortErrorHandler(shutdown, vi.fn(), vi.fn());

    await lastResort("unhandled_rejection", new Error("late crash"));

    expect(exit).toHaveBeenCalledWith(1);
    expect(errorLog).toHaveBeenCalledWith(
      "capacitylens-server: shutdown re-entered during drain " +
        "(reason=process_failure:unhandled_rejection); forcing exit",
    );
    releaseDrain();
    await first;
    errorLog.mockRestore();
  });

  it("logs details locally, emits only a classified security event and drains with failure", async () => {
    const shutdown = vi.fn(async () => {});
    const securityLog = vi.fn();
    const logError = vi.fn();
    const handler = createLastResortErrorHandler(
      shutdown,
      securityLog,
      logError,
    );
    const error = new Error("sensitive implementation detail");

    await handler("uncaught_exception", error);

    expect(logError).toHaveBeenCalledWith(
      "capacitylens-server: last-resort uncaught_exception",
      error,
    );
    expect(securityLog).toHaveBeenCalledWith({
      event: "process_failure",
      outcome: "failure",
      kind: "uncaught_exception",
    });
    expect(JSON.stringify(securityLog.mock.calls)).not.toContain(error.message);
    expect(shutdown).toHaveBeenCalledWith(
      1,
      "process_failure:uncaught_exception",
    );
  });

  it("still drains if security forwarding fails and normalizes a non-Error rejection", async () => {
    const shutdown = vi.fn(async () => {});
    const securityLog = vi.fn(() => {
      throw new Error("collector unavailable");
    });
    const logError = vi.fn();
    const handler = createLastResortErrorHandler(
      shutdown,
      securityLog,
      logError,
    );

    await handler("unhandled_rejection", "rejected value");

    expect(logError.mock.calls[0]?.[1]).toMatchObject({
      message: "Non-Error rejection: rejected value",
    });
    expect(shutdown).toHaveBeenCalledWith(
      1,
      "process_failure:unhandled_rejection",
    );
  });
});
