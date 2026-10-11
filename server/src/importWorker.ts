import { assertSupportedNodeVersion } from "../scripts/check-node.mjs";
import { isMainThread, parentPort } from "node:worker_threads";
import { remapAndValidateImport } from "@capacitylens/shared/domain/mutations";
import type { AppData, ID, ISOTimestamp } from "@capacitylens/shared/types/entities";

/**
 * Contains the serialized data and account context sent to one import worker.
 */
export interface ImportWorkerRequest {
  current: AppData;
  accountId: ID;
  incoming: AppData;
  now: ISOTimestamp;
}

/**
 * Matches the validated and remapped result returned by an import worker.
 */
export type ImportWorkerResult = ReturnType<typeof remapAndValidateImport>;

assertSupportedNodeVersion();

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
      // Send the preparation failure back to the parent worker boundary so import rejects before any replacement commits.
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
