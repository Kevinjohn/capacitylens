import { APP_DATA_KEYS } from "../types/entityKeys.js";
import type { AppData, ScopedEntityKey } from "../types/entities.js";
import { isRecord } from "../lib/isRecord.js";
import { hasUsablePrivateCodeName } from "../domain/privateNames.js";
import { assert, fail, isId, isOneOf } from "./betaTransfer.errors.js";
import { FIELDS, projectBetaData, validateRow } from "./betaTransfer.validation.js";
import { validateBetaReferences } from "./betaTransfer.references.js";
import { BetaTransferError } from "./betaTransfer.errors.js";

export { BetaTransferError };

/** Stable identifier for the beta-native interchange format. */
export const BETA_EXPORT_FORMAT = "capacitylens-beta" as const;
/** Beta interchange schema version, independent of database and legacy export versions. */
export const BETA_EXPORT_SCHEMA_VERSION = 1 as const;

export interface BetaExportDocument {
  format: typeof BETA_EXPORT_FORMAT;
  schemaVersion: typeof BETA_EXPORT_SCHEMA_VERSION;
  completeness: "full" | "redacted";
  data: AppData;
}

/** The destination facts needed to validate imported scheduling rows. */
export interface BetaImportContext {
  accountId: string;
  memberResourceLinks: readonly { memberId: string; resourceId: string }[];
}

/** A validated full import, ready for an atomic account replacement. */
export interface PreparedBetaImport {
  data: AppData;
  imported: number;
}

type Row = Record<string, unknown>;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function validateDocument(value: unknown): BetaExportDocument {
  assert(isRecord(value), "document", "must be an object");
  assert(value.format === BETA_EXPORT_FORMAT, "format", "is not a beta-native CapacityLens export");
  assert(value.schemaVersion === BETA_EXPORT_SCHEMA_VERSION, "schemaVersion", "is unsupported");
  assert(isOneOf(value.completeness, ["full", "redacted"]), "completeness", "must be full or redacted");
  assert(isRecord(value.data), "data", "must be an object");
  for (const key of APP_DATA_KEYS) {
    assert(
      own(value.data, key) && Array.isArray(value.data[key]),
      `data.${key}`,
      "table is required and must be a list",
    );
    (value.data[key] as unknown[]).forEach((row, i) =>
      validateRow(key, row, `data.${key}[${i}]`, { redacted: value.completeness === "redacted" }),
    );
  }
  const data = {} as AppData;
  for (const key of APP_DATA_KEYS) {
    const rows = value.data[key] as Row[];
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      if (seen.has(row.id as string)) fail(`data.${key}[${i}].id`, "duplicates a table id");
      seen.add(row.id as string);
    });
    (data as unknown as Record<string, unknown>)[key] = rows.map((row) =>
      Object.fromEntries(
        (FIELDS[key] as readonly string[])
          .filter((field) => own(row, field))
          .map((field) => {
            const fieldValue = row[field];
            return [
              field,
              Array.isArray(fieldValue) ? (fieldValue as unknown[]).map((item: unknown) => item) : fieldValue,
            ];
          }),
      ),
    );
  }
  const accountRows = data.accounts;
  assert(accountRows.length === 1, "data.accounts", "must contain exactly one account");
  const scoped = APP_DATA_KEYS.filter((key) => key !== "accounts") as ScopedEntityKey[];
  const account = accountRows[0];
  assert(account, "data.accounts", "must contain exactly one account");
  const accountId = account.id;
  for (const key of scoped)
    (data[key] as Array<{ accountId: string }>).forEach((row, i) =>
      assert(row.accountId === accountId, `data.${key}[${i}].accountId`, "does not match the exported account"),
    );
  if (value.completeness === "full") {
    for (const key of ["clients", "projects"] as const)
      data[key].forEach((row, i) => {
        if (row.isPrivate === true)
          assert(
            hasUsablePrivateCodeName(row as unknown as Record<string, unknown>),
            `data.${key}[${i}].codeName`,
            "a full private export must include its code name",
          );
      });
  }
  validateBetaReferences(data);
  return {
    format: BETA_EXPORT_FORMAT,
    schemaVersion: BETA_EXPORT_SCHEMA_VERSION,
    completeness: value.completeness as "full" | "redacted",
    data,
  };
}

/**
 * Build a portable projection for an account. The caller must authorize and redact the
 * supplied data before calling; completeness is metadata and does not grant visibility.
 */
export function buildBetaExport(
  data: AppData,
  options: { accountId: string; completeness: "full" | "redacted" },
): BetaExportDocument {
  const document = {
    format: BETA_EXPORT_FORMAT,
    schemaVersion: BETA_EXPORT_SCHEMA_VERSION,
    completeness: options.completeness,
    data: projectBetaData(data, options.accountId),
  };
  return validateDocument(document);
}

/** Serialize the named portable fields as formatted JSON after validating the entire document. */
export function serializeBetaExport(document: BetaExportDocument): string {
  const validated = validateDocument(document);
  return JSON.stringify(validated, null, 2);
}

/** Parse and strictly validate a beta-native export, projecting away undeclared properties. */
export function parseBetaExport(json: string): BetaExportDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch (cause) {
    throw new BetaTransferError("document", "is not valid JSON", { cause });
  }
  return validateDocument(raw);
}

/** Validate a full document against the selected destination account and member resource links. */
export function prepareBetaImport(document: unknown, context: BetaImportContext): PreparedBetaImport {
  assert(
    isRecord(context) && isId(context.accountId) && Array.isArray(context.memberResourceLinks),
    "context",
    "accountId and memberResourceLinks are required",
  );
  const validated = validateDocument(document);
  assert(validated.completeness === "full", "completeness", "only full exports can be imported");
  const importedAccount = validated.data.accounts[0];
  assert(importedAccount, "data.accounts", "must contain exactly one account");
  assert(importedAccount.id === context.accountId, "data.accounts[0].id", "must exactly match the destination account");
  const personIds = new Set(validated.data.resources.filter((row) => row.kind === "person").map((row) => row.id));
  for (const [i, link] of context.memberResourceLinks.entries()) {
    assert(
      isRecord(link) && isId(link.memberId) && isId(link.resourceId),
      `context.memberResourceLinks[${i}]`,
      "requires memberId and resourceId",
    );
    assert(
      personIds.has(link.resourceId),
      `context.memberResourceLinks[${i}].resourceId`,
      `resource id ${link.resourceId} does not identify an imported person`,
    );
  }
  let imported = 0;
  for (const key of APP_DATA_KEYS) imported += validated.data[key].length;
  return { data: validated.data, imported };
}
