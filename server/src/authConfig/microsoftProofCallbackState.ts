import type { MicrosoftProofIntent } from "./microsoftProofPrimitives";
import { hashProofValue, MicrosoftProofError } from "./microsoftProofPrimitives";
import type { Db } from "../db";

export function invalidStoredCallback(
  stored: Pick<MicrosoftProofIntent, "id" | "state" | "expiresAt">,
  current: MicrosoftProofIntent | null,
): boolean {
  return !current || stored.id !== current.id || stored.state === "cancelled" || stored.expiresAt <= Date.now();
}

export function invalidCurrentCallback(current: MicrosoftProofIntent, stateHash: string): boolean {
  return (
    current.state !== "completed" &&
    current.state !== "cancelled" &&
    current.expiresAt > Date.now() &&
    current.oauthStateHash !== stateHash
  );
}

export function createMicrosoftCallbackState(db: Db, fromHeaders: (headers: Headers) => MicrosoftProofIntent | null) {
  function store(intentId: string, authorizationUrl: string): void {
    const state = new URL(authorizationUrl).searchParams.get("state");
    if (!state) throw new MicrosoftProofError("MICROSOFT_PROVIDER_UNAVAILABLE", 503);
    db.prepare(
      `UPDATE microsoft_identity_proofs
      SET oauthStateHistory = CASE WHEN oauthStateHash IS NULL THEN oauthStateHistory
        ELSE json_insert(oauthStateHistory, '$[#]', oauthStateHash) END,
          oauthStateHash = ?, updatedAt = ?
      WHERE id = ? AND state IN ('started','mail-sent','approved')`,
    ).run(hashProofValue(state), Date.now(), intentId);
  }

  function validate(request: Request): void {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    if (!state) {
      if (url.searchParams.has("error") && fromHeaders(request.headers)) {
        throw new MicrosoftProofError("MICROSOFT_PROOF_CALLBACK_MISMATCH", 403);
      }
      return;
    }
    const stateHash = hashProofValue(state);
    const stored = db
      .prepare(
        `SELECT id, nonceHash, state, expiresAt, oauthStateHash
      FROM microsoft_identity_proofs WHERE oauthStateHash = ?
      OR EXISTS (SELECT 1 FROM json_each(microsoft_identity_proofs.oauthStateHistory) WHERE value = ?) LIMIT 1`,
      )
      .get(stateHash, stateHash) as
      Pick<MicrosoftProofIntent, "id" | "nonceHash" | "state" | "expiresAt" | "oauthStateHash"> | undefined;
    const current = fromHeaders(request.headers);
    if (stored && (invalidStoredCallback(stored, current) || stored.oauthStateHash !== stateHash)) {
      throw new MicrosoftProofError("MICROSOFT_PROOF_CALLBACK_MISMATCH", 403);
    }
    if (current && invalidCurrentCallback(current, stateHash)) {
      throw new MicrosoftProofError("MICROSOFT_PROOF_CALLBACK_MISMATCH", 403);
    }
  }

  return { store, validate };
}
