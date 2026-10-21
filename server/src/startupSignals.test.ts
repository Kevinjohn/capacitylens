import { afterEach, describe, expect, it, vi } from "vitest";
import { installStartupSignalHandlers, stopStartupIfRequested } from "./startupSignals";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startup signal handlers", () => {
  const controllers: Array<{ dispose(): void }> = [];
  afterEach(() => {
    for (const controller of controllers.splice(0)) controller.dispose();
  });

  it("latches the first signal for a safe checkpoint and force-handles a repeat", () => {
    const onRequested = vi.fn();
    const onRepeated = vi.fn();
    const controller = installStartupSignalHandlers({ onRequested, onRepeated });
    controllers.push(controller);

    process.emit("SIGTERM");
    expect(controller.requested()).toBe("SIGTERM");
    expect(onRequested).toHaveBeenCalledWith("SIGTERM");
    expect(onRepeated).not.toHaveBeenCalled();

    process.emit("SIGINT");
    expect(controller.requested()).toBe("SIGTERM");
    expect(onRepeated).toHaveBeenCalledWith("SIGINT");
  });

  it("removes both temporary listeners before full shutdown takes ownership", () => {
    const onRequested = vi.fn();
    const controller = installStartupSignalHandlers({ onRequested, onRepeated: vi.fn() });
    controllers.push(controller);

    controller.dispose();
    process.emit("SIGTERM");
    process.emit("SIGINT");

    expect(onRequested).not.toHaveBeenCalled();
  });
});

describe("startup stop checkpoints", () => {
  it("does nothing when no startup signal is requested", () => {
    const stopped = new Error("test exit sentinel");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw stopped;
    });
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const close = vi.fn();
    const dispose = vi.fn();

    stopStartupIfRequested({ startupSignals: { requested: () => null, dispose }, openDb: { close } });

    expect(close).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("closes the database before disposing and exiting at a requested checkpoint", () => {
    const stopped = new Error("test exit sentinel");
    const order: string[] = [];
    vi.spyOn(process, "exit").mockImplementation((code) => {
      order.push("exit " + code);
      throw stopped;
    });

    expect(() =>
      stopStartupIfRequested({
        startupSignals: {
          requested: () => "SIGTERM",
          dispose: () => {
            order.push("dispose");
          },
        },
        openDb: {
          close: () => {
            order.push("close");
          },
        },
      }),
    ).toThrow(stopped);

    expect(order).toEqual(["close", "dispose", "exit 0"]);
  });
});

describe("startup stop checkpoint failures", () => {
  it("reports a close failure before disposing and exiting", () => {
    const stopped = new Error("test exit sentinel");
    const cause = new Error("close failed");
    const order: string[] = [];
    const report = vi.spyOn(console, "error").mockImplementation(() => {
      order.push("report");
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      order.push("exit " + code);
      throw stopped;
    });

    expect(() =>
      stopStartupIfRequested({
        startupSignals: {
          requested: () => "SIGINT",
          dispose: () => {
            order.push("dispose");
          },
        },
        openDb: {
          close: () => {
            order.push("close");
            throw cause;
          },
        },
      }),
    ).toThrow(stopped);

    expect(report).toHaveBeenCalledExactlyOnceWith(
      "capacitylens-server: database close failed while stopping startup",
      cause,
    );
    expect(order).toEqual(["close", "report", "dispose", "exit 0"]);
  });
});

describe("startup stop checkpoint without a database", () => {
  it("disposes and exits when the database has not been opened", () => {
    const stopped = new Error("test exit sentinel");
    const order: string[] = [];
    vi.spyOn(process, "exit").mockImplementation((code) => {
      order.push("exit " + code);
      throw stopped;
    });

    expect(() =>
      stopStartupIfRequested({
        startupSignals: {
          requested: () => "SIGTERM",
          dispose: () => {
            order.push("dispose");
          },
        },
      }),
    ).toThrow(stopped);

    expect(order).toEqual(["dispose", "exit 0"]);
  });
});
