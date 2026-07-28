import { afterEach, describe, expect, it, vi } from "vitest";
import { installStartupSignalHandlers } from "./startupSignals";

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
