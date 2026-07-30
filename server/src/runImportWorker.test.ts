import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { ImportWorkerRequest, ImportWorkerResult } from "./importWorker";
import { runWithRequestAbortSignal } from "./requestAbort";
import { createImportWorkerRunner } from "./runImportWorker";

const request: ImportWorkerRequest = {
  current: emptyAppData(),
  incoming: emptyAppData(),
  accountId: "account-1",
  now: "2026-07-30T00:00:00.000Z",
};

const result: ImportWorkerResult = { data: emptyAppData(), imported: 0, skipped: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

class FakeWorker extends EventEmitter {
  readonly postMessage = vi.fn();
  readonly terminate: ReturnType<typeof vi.fn<() => Promise<number>>>;

  constructor(termination: Promise<number> = Promise.resolve(0)) {
    super();
    this.terminate = vi.fn(() => termination);
  }
}

describe("bounded import worker runner", () => {
  it("bounds admission, withdraws queued aborts, joins active cancellation, and then reuses capacity", async () => {
    const firstTermination = deferred<number>();
    const workers: FakeWorker[] = [];
    const reportSaturation = vi.fn();
    const runner = createImportWorkerRunner({
      maxActive: 1,
      maxQueued: 1,
      maxWaitMs: 10_000,
      createWorker: () => {
        const worker = new FakeWorker(workers.length === 0 ? firstTermination.promise : Promise.resolve(0));
        workers.push(worker);
        return worker;
      },
    });
    const run = (controller: AbortController) =>
      runWithRequestAbortSignal(controller.signal, () => runner(request), reportSaturation);

    const activeController = new AbortController();
    const active = run(activeController);
    expect(workers).toHaveLength(1);

    const queuedController = new AbortController();
    const queued = run(queuedController);
    expect(workers).toHaveLength(1);

    const overflowController = new AbortController();
    await expect(run(overflowController)).rejects.toMatchObject({ name: "WorkQueueFullError", reason: "full" });
    expect(reportSaturation).toHaveBeenCalledOnce();
    expect(reportSaturation).toHaveBeenCalledWith("import", "full");

    const queuedRejection = expect(queued).rejects.toThrow("queued request gone");
    queuedController.abort(new Error("queued request gone"));
    await queuedRejection;
    expect(workers).toHaveLength(1);

    const replacementController = new AbortController();
    const replacement = run(replacementController);
    const activeRejection = expect(active).rejects.toThrow("active request gone");
    activeController.abort(new Error("active request gone"));
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(workers).toHaveLength(1);

    firstTermination.resolve(0);
    await activeRejection;
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1]!.emit("message", { ok: true, result });
    await expect(replacement).resolves.toEqual(result);
    expect(workers[1]!.postMessage).toHaveBeenCalledWith(request);
  });
});
