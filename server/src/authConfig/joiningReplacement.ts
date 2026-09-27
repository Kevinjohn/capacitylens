import type { Db } from "../db";
import { hashProofValue, readProofCookie } from "./microsoftProofPrimitives";

/** Replacing a browser journey invalidates its other provider family in the same write transaction. */
export function cancelMicrosoftJoinForBrowser(input: {
  db: Db;
  headers: Headers;
  applicationId: string;
  secureCookies: boolean;
  now: number;
}): void {
  const { db, headers, applicationId, secureCookies, now } = input;
  const name = `${secureCookies ? `__Host-${applicationId}` : applicationId}-microsoft-proof`;
  const nonce = readProofCookie(headers, name);
  if (!nonce || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return;
  db.prepare(
    `UPDATE microsoft_identity_proofs SET state = 'cancelled', tokenHash = NULL, updatedAt = ?
    WHERE nonceHash = ? AND purpose = 'join' AND state IN ('started','mail-sent','approved','completed')`,
  ).run(now, hashProofValue(nonce));
}
