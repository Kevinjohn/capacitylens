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

function readWorker(workers: readonly FakeWorker[], index: number): FakeWorker {
  const worker = workers[index];
  if (!worker) throw new Error(`Expected worker at index ${index}.`);
  return worker;
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
    expect(readWorker(workers, 0).terminate).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(workers).toHaveLength(1);

    firstTermination.resolve(0);
    await activeRejection;
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    readWorker(workers, 1).emit("message", { ok: true, result });
    await expect(replacement).resolves.toEqual(result);
    expect(readWorker(workers, 1).postMessage).toHaveBeenCalledWith(request);
  });

  it("rejects when a completed worker cannot terminate", async () => {
    const terminationError = new Error("termination failed");
    const worker = new FakeWorker(Promise.reject(terminationError));
    const runner = createImportWorkerRunner({ createWorker: () => worker });

    const pendingResult = runner(request);
    worker.emit("message", { ok: true, result });

    await expect(pendingResult).rejects.toBe(terminationError);
  });
});

describe("import worker terminal settlement", () => {
  it("terminates after synchronous post failure before releasing queue capacity", async () => {
    const termination = deferred<number>();
    const workers: FakeWorker[] = [];
    const postError = new Error("post failed");
    const runner = createImportWorkerRunner({
      maxActive: 1,
      createWorker: () => {
        const worker = new FakeWorker(workers.length === 0 ? termination.promise : Promise.resolve(0));
        if (workers.length === 0)
          worker.postMessage.mockImplementation(() => {
            throw postError;
          });
        workers.push(worker);
        return worker;
      },
    });

    const failed = runner(request);
    const failedResult = expect(failed).rejects.toBe(postError);
    const queued = runner(request);
    expect(readWorker(workers, 0).terminate).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(1);

    termination.resolve(0);
    await failedResult;
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    readWorker(workers, 1).emit("message", { ok: true, result });
    await expect(queued).resolves.toEqual(result);
  });

  it.each([0, 7])("rejects an exit with status %i before a valid response", async (code) => {
    const worker = new FakeWorker();
    const runner = createImportWorkerRunner({ createWorker: () => worker });

    const pending = runner(request);
    worker.emit("exit", code);

    await expect(pending).rejects.toThrow(`Import worker exited with status ${code}.`);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});

describe("import worker competing terminal events", () => {
  it("settles only once when a valid response is followed by exit", async () => {
    const worker = new FakeWorker();
    const runner = createImportWorkerRunner({ createWorker: () => worker });

    const pending = runner(request);
    worker.emit("message", { ok: true, result });
    worker.emit("exit", 0);

    await expect(pending).resolves.toEqual(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("keeps abort authoritative when a response races worker termination", async () => {
    const termination = deferred<number>();
    const worker = new FakeWorker(termination.promise);
    const controller = new AbortController();
    const runner = createImportWorkerRunner({ createWorker: () => worker });

    const pending = runner(request, controller.signal);
    controller.abort(new Error("request aborted"));
    worker.emit("message", { ok: true, result });
    termination.resolve(0);

    await expect(pending).rejects.toThrow("request aborted");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
