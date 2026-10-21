import { dirname, join } from "node:path";
export { createFileAuditSink } from "./audit/createFileAuditSink";
export { createCompositeAuditSink, createNoopAuditSink, createStreamAuditSink } from "./audit/sinks";
export { AUDIT_RECOVERY_SCAN_BYTES, MAX_AUDIT_BYTES } from "./audit/types";
export type { AuditDeliveryMetadata, AuditEntry, AuditRecord, AuditSink, FileAuditSinkOptions } from "./audit/types";
// The audit sink receives metadata-only product and account events.
// Never pass row values, request bodies, bearer tokens, credentials or claims to append.
// changedFields contains field names; principal and entity IDs identify the operation.
/**
 * Parse the audit config from env. On by default (`CAPACITYLENS_AUDIT !== 'off'`), the deliberate
 * flag-off exception to the repo's usual fail-closed default, because an audit trail you forgot to
 * enable is the failure mode that matters here. The file defaults beside the DB
 * (`capacitylens-audit.jsonl` in the DB's directory); a `:memory:` DB (dirname '.') falls back to a
 * CWD-relative file.
 *
 * @param environment    process.env (or a test stub)
 * @param dbPath the resolved DB path, used only to site the default audit file
 * @returns `{ enabled, file }`: index.ts builds a fileAuditSink when enabled, else a noopAuditSink
 */
export function parseAuditConfig(
  environment: Record<string, string | undefined>,
  dbPath: string,
): { enabled: boolean; file: string } {
  const enabled = environment.CAPACITYLENS_AUDIT !== "off";
  // dirname(':memory:') is '.', which join() resolves to CWD-relative, exactly the fallback we
  // want for an in-memory DB (no on-disk DB to sit beside).
  // Compose mapping pass-throughs define omitted values as ''. Treat that generated empty value as
  // absent so deployments outside the packaged Compose file cannot accidentally create a sink at an
  // unusable path. Deliberately do not trim: spaces can be valid in an explicitly configured path.
  const configuredFile = environment.CAPACITYLENS_AUDIT_FILE;
  const file =
    configuredFile === "" || configuredFile === undefined
      ? join(dirname(dbPath), "capacitylens-audit.jsonl")
      : configuredFile;
  return { enabled, file };
}
