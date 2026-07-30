import { Worker } from "node:worker_threads";
import type { ImportWorkerRequest, ImportWorkerResult } from "./importWorker";

interface WorkerReply {
  ok: boolean;
  result?: ImportWorkerResult;
  error?: { name?: string; message: string; stack?: string };
}

/** Run CPU-heavy import remapping away from Fastify's event loop. */
export function runImportWorker(request: ImportWorkerRequest): Promise<ImportWorkerResult> {
  return new Promise((resolve, reject) => {
    const sourceRuntime = import.meta.url.endsWith(".ts");
    const worker = new Worker(new URL(sourceRuntime ? "./importWorker.ts" : "./importWorker.mjs", import.meta.url), {
      execArgv: sourceRuntime ? ["--import", "tsx"] : [],
    });
    let settled = false;
    const finish = (error?: Error, result?: ImportWorkerResult) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
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
