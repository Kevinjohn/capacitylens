import { isMainThread, parentPort } from "node:worker_threads";
import { remapAndValidateImport } from "@capacitylens/shared/domain/mutations";
import type { AppData, ID, ISOTimestamp } from "@capacitylens/shared/types/entities";

export interface ImportWorkerRequest {
  current: AppData;
  accountId: ID;
  incoming: AppData;
  now: ISOTimestamp;
}

export type ImportWorkerResult = ReturnType<typeof remapAndValidateImport>;

if (!isMainThread) {
  const workerPort = parentPort;
  if (!workerPort) throw new Error("Import worker started without a parent port.");
  workerPort.once("message", (request: ImportWorkerRequest) => {
    try {
      workerPort.postMessage({
        ok: true,
        result: remapAndValidateImport(request.current, request.accountId, request.incoming, request.now),
      });
    } catch (error) {
      workerPort.postMessage({
        ok: false,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : { message: String(error) },
      });
    }
  });
}
