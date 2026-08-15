import { Worker } from "node:worker_threads";
import type { ImportWorkerRequest, ImportWorkerResult } from "./importWorker";
import { currentRequestAbortSignal, reportCurrentRequestQueueSaturation } from "./requestAbort";
import { abortReason, BoundedWorkQueue } from "./workQueue";

export const MAX_CONCURRENT_IMPORT_WORKERS = 2;
export const MAX_QUEUED_IMPORT_WORKERS = 8;
export const MAX_IMPORT_QUEUE_WAIT_MS = 5_000;
const IMPORT_CAPACITY_MESSAGE = "Import preparation is temporarily at capacity. Retry shortly.";

interface WorkerReply {
  ok: boolean;
  result?: ImportWorkerResult;
  error?: { name?: string; message: string; stack?: string };
}

interface ImportWorkerThread {
  once(event: "message", listener: (reply: WorkerReply) => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "exit", listener: (code: number) => void): this;
  postMessage(request: ImportWorkerRequest): void;
  terminate(): Promise<number>;
}

export interface ImportWorkerRunnerOptions {
  maxActive?: number;
  maxQueued?: number;
  maxWaitMs?: number;
  createWorker?: () => ImportWorkerThread;
}

function defaultWorker(): Worker {
  const sourceRuntime = import.meta.url.endsWith(".ts");
  return new Worker(new URL(sourceRuntime ? "./importWorker.ts" : "./importWorker.mjs", import.meta.url), {
    execArgv: sourceRuntime ? ["--import", "tsx"] : [],
  });
}

function executeImportWorker(
  request: ImportWorkerRequest,
  signal: AbortSignal | undefined,
  createWorker: () => ImportWorkerThread,
): Promise<ImportWorkerResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const worker = createWorker();
    let settled = false;
    const finish = (error?: Error, result?: ImportWorkerResult) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      signal!.removeEventListener("abort", abort);
      // Do not release the bounded queue slot until the thread has actually stopped. Otherwise a
      // burst of disconnected requests could exceed the configured active-worker ceiling.
      void worker.terminate().then(
        () => reject(abortReason(signal!)),
        (error: unknown) => reject(error),
      );
    };
    if (signal) signal.addEventListener("abort", abort, { once: true });
    worker.once("message", (reply: WorkerReply) => {
      if (reply.ok && reply.result) return finish(undefined, reply.result);
      const error = new Error(reply.error?.message ?? "Import worker failed.");
      error.name = reply.error?.name ?? "Error";
      if (reply.error?.stack) error.stack = reply.error.stack;
      finish(error);
    });
    worker.once("error", (error) => finish(error));
    worker.once("exit", (code) => {
      if (code !== 0) finish(new Error(`Import worker exited with status ${code}.`));
    });
    worker.postMessage(request);
  });
}

/** Build a bounded runner; exported so cancellation and admission behavior can be tested without
 * starting real threads. Production uses the singleton below, keeping one process-wide cap. */
export function createImportWorkerRunner(options: ImportWorkerRunnerOptions = {}) {
  const queue = new BoundedWorkQueue(
    options.maxActive ?? MAX_CONCURRENT_IMPORT_WORKERS,
    options.maxQueued ?? MAX_QUEUED_IMPORT_WORKERS,
    IMPORT_CAPACITY_MESSAGE,
    {
      maxWaitMs: options.maxWaitMs ?? MAX_IMPORT_QUEUE_WAIT_MS,
      onSaturated: (reason) => reportCurrentRequestQueueSaturation("import", reason),
    },
  );
  const createWorker = options.createWorker ?? defaultWorker;
  return (request: ImportWorkerRequest, signal: AbortSignal | undefined = currentRequestAbortSignal()) =>
    queue.run(() => executeImportWorker(request, signal, createWorker), signal);
}

/** Run CPU-heavy import remapping away from Fastify's event loop. */
export const runImportWorker = createImportWorkerRunner();
