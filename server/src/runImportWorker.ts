import { Worker } from "node:worker_threads";
import type { ImportWorkerRequest, ImportWorkerResult } from "./importWorker";
import { readCurrentRequestAbortSignal, reportCurrentRequestQueueSaturation } from "./requestAbort";
import { readAbortReason, BoundedWorkQueue } from "./workQueue";

export const MAX_CONCURRENT_IMPORT_WORKERS = 2;
export const MAX_QUEUED_IMPORT_WORKERS = 8;
export const MAX_IMPORT_QUEUE_WAIT_MS = 5_000;
const IMPORT_CAPACITY_MESSAGE = "Import preparation is temporarily at capacity. Retry shortly.";

interface WorkerReply {
  ok: boolean;
  result?: ImportWorkerResult;
  error?: { name?: string; message: string; stack?: string };
}

type ImportWorkerExecutionOutcome =
  { kind: "completed"; result: ImportWorkerResult } | { kind: "failed"; reason: unknown };

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

function createDefaultWorker(): Worker {
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
    if (signal?.aborted) return reject(readAbortReason(signal));
    const worker = createWorker();
    let settled = false;
    let abort: (() => void) | undefined;
    const resolveWorkerOutcome = (outcome: ImportWorkerExecutionOutcome) => {
      if (settled) return;
      settled = true;
      if (signal && abort) signal.removeEventListener("abort", abort);
      void worker.terminate().then(
        () => (outcome.kind === "completed" ? resolve(outcome.result) : reject(outcome.reason)),
        (terminationError: unknown) => reject(terminationError),
      );
    };
    if (signal) {
      abort = () => resolveWorkerOutcome({ kind: "failed", reason: readAbortReason(signal) });
      signal.addEventListener("abort", abort, { once: true });
    }
    worker.once("message", (reply: WorkerReply) => {
      if (reply.ok && reply.result) return resolveWorkerOutcome({ kind: "completed", result: reply.result });
      const error = new Error(reply.error?.message ?? "Import worker failed.");
      error.name = reply.error?.name ?? "Error";
      if (reply.error?.stack) error.stack = reply.error.stack;
      resolveWorkerOutcome({ kind: "failed", reason: error });
    });
    worker.once("error", (error) => resolveWorkerOutcome({ kind: "failed", reason: error }));
    worker.once("exit", (code) => {
      if (code !== 0)
        resolveWorkerOutcome({ kind: "failed", reason: new Error(`Import worker exited with status ${code}.`) });
    });
    worker.postMessage(request);
  });
}

/** Build a bounded runner; exported so cancellation and admission behavior can be tested without
 * starting real threads. Production uses the singleton below, keeping one process-wide cap. */
export function createImportWorkerRunner(options: ImportWorkerRunnerOptions = {}) {
  const queue = new BoundedWorkQueue({
    maxActive: options.maxActive ?? MAX_CONCURRENT_IMPORT_WORKERS,
    maxQueued: options.maxQueued ?? MAX_QUEUED_IMPORT_WORKERS,
    fullMessage: IMPORT_CAPACITY_MESSAGE,
    options: {
      maxWaitMs: options.maxWaitMs ?? MAX_IMPORT_QUEUE_WAIT_MS,
      onSaturated: (reason) => reportCurrentRequestQueueSaturation("import", reason),
    },
  });
  const createWorker = options.createWorker ?? createDefaultWorker;
  return (request: ImportWorkerRequest, signal: AbortSignal | undefined = readCurrentRequestAbortSignal()) =>
    queue.run(() => executeImportWorker(request, signal, createWorker), signal);
}

/** Run CPU-heavy import remapping away from Fastify's event loop. */
export const runImportWorker = createImportWorkerRunner();
