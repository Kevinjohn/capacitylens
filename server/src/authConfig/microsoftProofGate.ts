import type { Db } from "../db";
import { buildApplicationSessionHandle } from "../accounts/buildApplicationSessionHandle";
import { microsoftCallbackCapture } from "./captureContexts";
import { MICROSOFT_ACCOUNT_INSERT_GATE } from "../db/microsoftProofGateSql";
import { isApprovedEmailDomain } from "@capacitylens/shared/account/approvedDomains";

/** The request-local proof id is read synchronously by the SQLite trigger at the account INSERT. */
export function ensureMicrosoftProofGate(db: Db, applicationId: string): void {
  db.function("capacitylens_current_microsoft_proof_id", () => microsoftCallbackCapture.getStore()?.proofId ?? null);
  db.function("capacitylens_microsoft_session_handle", (token) =>
    buildApplicationSessionHandle(applicationId, String(token)),
  );
  db.function("capacitylens_approved_domain_matches", (email, domains) => {
    if (typeof email !== "string" || typeof domains !== "string") return 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(domains);
    } catch {
      return 0;
    }
    return Array.isArray(parsed) &&
      parsed.every((domain) => typeof domain === "string") &&
      isApprovedEmailDomain(email, parsed)
      ? 1
      : 0;
  });
  db.exec(MICROSOFT_ACCOUNT_INSERT_GATE);
}
