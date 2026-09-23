import type { Db } from "../db";
import { buildApplicationSessionHandle } from "../accounts/buildApplicationSessionHandle";
import { microsoftCallbackCapture } from "./captureContexts";
import { MICROSOFT_ACCOUNT_INSERT_GATE } from "../db/microsoftProofGateSql";

/** The request-local proof id is read synchronously by the SQLite trigger at the account INSERT. */
export function ensureMicrosoftProofGate(db: Db, applicationId: string): void {
  db.function("capacitylens_current_microsoft_proof_id", () => microsoftCallbackCapture.getStore()?.proofId ?? null);
  db.function("capacitylens_microsoft_session_handle", (token) =>
    buildApplicationSessionHandle(applicationId, String(token)),
  );
  db.exec(MICROSOFT_ACCOUNT_INSERT_GATE);
}
