import { dirname, join } from "node:path";
export { fileAuditSink } from "./audit/fileSink";
export { compositeAuditSink, noopAuditSink, streamAuditSink } from "./audit/sinks";
export { AUDIT_RECOVERY_SCAN_BYTES, MAX_AUDIT_BYTES } from "./audit/types";
export type { AuditDeliveryMetadata, AuditEntry, AuditRecord, AuditSink, FileAuditSinkOptions } from "./audit/types";
// Append-only JSONL audit sink (P1.15, flag CAPACITYLENS_AUDIT — ON BY DEFAULT, opt-out =off).
// It records one legacy product AuditRecord per AppData mutation plus normalized AccountAuditEvent
// entries emitted by cross-port account flows. SERVER-MODE ONLY: the sink lives in the server (built in
// index.ts from env), so the default local/no-server deploy never runs it — buildApp's factory
// defaults to noopAuditSink(), keeping the default deploy and every test byte-identical unless a
// sink is explicitly passed.
//
// THE #1 INVARIANT — NO RAW PII EVER REACHES A LINE. `changedFields` is field NAMES only
// (Object.keys of the wire body/row); a VALUE, a ROW, or a request BODY must NEVER be handed to
// append(). Names + ids are operational metadata (who changed what, when); values are tenant PII
// (a time-off note, a person's name) and are deliberately excluded. Product callers compute
// changedFields with `Object.keys`; AccountFlows emits fixed field names and command correlation.
// Neither path passes a request body, row, bearer, credential, token or claim set.
/**
 * Parse the audit config from env. ON BY DEFAULT (`CAPACITYLENS_AUDIT !== 'off'`) — the deliberate
 * flag-OFF exception to the repo's usual fail-closed default, because an audit trail you forgot to
 * enable is the failure mode that matters here. The file defaults BESIDE the DB
 * (`capacitylens-audit.jsonl` in the DB's directory); a `:memory:` DB (dirname '.') falls back to a
 * CWD-relative file.
 *
 * @param env    process.env (or a test stub)
 * @param dbPath the resolved DB path, used only to site the default audit file
 * @returns `{ enabled, file }` — index.ts builds a fileAuditSink when enabled, else a noopAuditSink
 */
export function parseAuditConfig(
  env: Record<string, string | undefined>,
  dbPath: string,
): { enabled: boolean; file: string } {
  const enabled = env.CAPACITYLENS_AUDIT !== "off";
  // dirname(':memory:') is '.', which join() resolves to CWD-relative — exactly the fallback we
  // want for an in-memory DB (no on-disk DB to sit beside).
  // Compose mapping pass-throughs define omitted values as ''. Treat that generated empty value as
  // absent so deployments outside the packaged Compose file cannot accidentally create a sink at an
  // unusable path. Deliberately do not trim: spaces can be valid in an explicitly configured path.
  const file = env.CAPACITYLENS_AUDIT_FILE || join(dirname(dbPath), "capacitylens-audit.jsonl");
  return { enabled, file };
}
