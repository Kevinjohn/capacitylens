import { createHash } from "node:crypto";
import { AccountContractError, type AccountErrorCode } from "@capacitylens/shared/account/errors";
import type { CommandIdentity, PrincipalId } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import {
  correlatePendingAccountCommand,
  eraseWorkspaceCommandHistoryInTx,
  finishAccountCommand,
  finishAccountCommandIfPending,
  getAccountCommand,
  getAccountCommandById,
  getAccountCommandByIdForReconciliation,
  reserveAccountCommand,
  type AccountCommandRecord,
} from "./state";

// The coordinator owns durable command lifecycles, but not their SQLite representation. Re-export
// the complete ledger vocabulary through this seam so orchestration never reaches state.ts directly.
export {
  correlatePendingAccountCommand,
  eraseWorkspaceCommandHistoryInTx,
  getAccountCommandById,
  getAccountCommandByIdForReconciliation,
};

const replayedCommandResults = new WeakSet<object>();

function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function buildCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? "null" : encoded;
  }
  if (Array.isArray(value)) return `[${value.map((child) => buildCanonicalJson(child)).join(",")}]`;
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") return buildCanonicalJson(toJSON.call(value));
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    // Command hashes cross browser/server/process boundaries. Locale-aware ordering can vary with
    // the host locale, so canonical JSON must use ECMAScript code-unit ordering only.
    .sort(([left], [right]) => compareCanonicalKeys(left, right));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${buildCanonicalJson(child)}`).join(",")}}`;
}

/** Mark a successful result as an idempotent replay without leaking transport-only metadata into
 * the provider-neutral response shape. HTTP adapters use this to avoid logging a second mutation
 * audit event for a request that merely re-read an already committed result. */
export function markAccountCommandReplay<T>(result: T): T {
  if ((typeof result === "object" && result !== null) || typeof result === "function") {
    replayedCommandResults.add(result);
  }
  return result;
}

export function wasAccountCommandReplayed(result: unknown): boolean {
  return (
    ((typeof result === "object" && result !== null) || typeof result === "function") &&
    replayedCommandResults.has(result)
  );
}

export function buildAccountPayloadHash(payload: unknown): string {
  return createHash("sha256").update(buildCanonicalJson(payload)).digest("hex");
}

export function buildSecretDigest(purpose: string, secret: string): string {
  return createHash("sha256").update(`smallsass-account:${purpose}\0`).update(secret).digest("hex");
}

export interface CommandScope {
  applicationId: string;
  operation: string;
  actorPrincipalId: PrincipalId | null;
  targetPrincipalId?: PrincipalId | null;
  workspaceId?: string | null;
}

export type BeginCommandResult<T> =
  { kind: "execute"; record: AccountCommandRecord } | { kind: "replay"; record: AccountCommandRecord; result: T };

type ReplayedCommand<T> = Extract<BeginCommandResult<T>, { kind: "replay" }>;

function throwCommandConflict(
  record: AccountCommandRecord,
  scope: Pick<CommandScope, "applicationId" | "operation" | "actorPrincipalId">,
  command: CommandIdentity,
): never {
  const commandIdReused =
    record.commandId === command.commandId &&
    (record.applicationId !== scope.applicationId ||
      record.operation !== scope.operation ||
      record.idempotencyKey !== command.idempotencyKey);
  throw new AccountContractError({
    code: "IDEMPOTENCY_CONFLICT",
    message: commandIdReused
      ? "That command id is already bound to another account operation."
      : record.commandId !== command.commandId
        ? "That idempotency key is already bound to another command id."
        : record.actorPrincipalId !== scope.actorPrincipalId
          ? "That idempotency key is already bound to another command context."
          : "That idempotency key was already used for a different command payload.",
    retryable: false,
    commandId: record.commandId,
  });
}

function replayOrRejectExistingCommand<T>(record: AccountCommandRecord): ReplayedCommand<T> {
  if (record.status === "completed" && record.resultJson !== null) {
    return {
      kind: "replay",
      record,
      result: JSON.parse(record.resultJson) as T,
    };
  }
  throw new AccountContractError({
    code:
      record.status === "reconciliation_required"
        ? "DEPENDENCY_UNAVAILABLE"
        : record.status === "pending"
          ? "COMMAND_IN_PROGRESS"
          : "CONFLICT",
    message:
      record.status === "pending"
        ? "That command is already in progress."
        : "That command already reached a terminal non-success state.",
    retryable: record.status === "pending" || record.status === "reconciliation_required",
    commandId: record.commandId,
  });
}

interface ResumeExistingCommandInput {
  db: Db;
  scope: CommandScope;
  command: CommandIdentity;
  canonicalPayload: unknown;
}

/**
 * Read an existing command outcome without pruning, reserving, or changing ledger state.
 *
 * Bearer-authorized flows use this before validating a now-single-use bearer so a completed retry
 * can still replay, while an attacker presenting a new invalid bearer cannot cause a database write.
 */
export function resumeExistingCommand<T>({
  db,
  scope,
  command,
  canonicalPayload,
}: ResumeExistingCommandInput): ReplayedCommand<T> | null {
  const existing = getAccountCommand({
    db,
    applicationId: scope.applicationId,
    operation: scope.operation,
    idempotencyKey: command.idempotencyKey,
  });
  if (!existing) return null;
  if (
    existing.commandId !== command.commandId ||
    existing.actorPrincipalId !== scope.actorPrincipalId ||
    existing.payloadHash !== buildAccountPayloadHash(canonicalPayload)
  ) {
    return throwCommandConflict(existing, scope, command);
  }
  return replayOrRejectExistingCommand<T>(existing);
}

interface BeginCommandInput {
  db: Db;
  scope: CommandScope;
  command: CommandIdentity;
  canonicalPayload: unknown;
}

export function beginCommand<T>({ db, scope, command, canonicalPayload }: BeginCommandInput): BeginCommandResult<T> {
  const reserved = reserveAccountCommand(db, {
    applicationId: scope.applicationId,
    operation: scope.operation,
    idempotencyKey: command.idempotencyKey,
    commandId: command.commandId,
    actorPrincipalId: scope.actorPrincipalId,
    targetPrincipalId: scope.targetPrincipalId ?? null,
    workspaceId: scope.workspaceId ?? null,
    payloadHash: buildAccountPayloadHash(canonicalPayload),
  });
  if (reserved.kind === "conflict") {
    return throwCommandConflict(reserved.record, scope, command);
  }
  if (reserved.kind === "reserved") return { kind: "execute", record: reserved.record };
  return replayOrRejectExistingCommand<T>(reserved.record);
}

interface CompleteCommandInput {
  db: Db;
  scope: Pick<CommandScope, "applicationId" | "operation">;
  command: CommandIdentity;
  result: unknown;
}

export function completeCommand({ db, scope, command, result }: CompleteCommandInput): void {
  finishAccountCommand(db, {
    applicationId: scope.applicationId,
    operation: scope.operation,
    idempotencyKey: command.idempotencyKey,
    status: "completed",
    resultJson: buildCanonicalJson(result),
  });
}

interface BuildFinishInputInput {
  scope: Pick<CommandScope, "applicationId" | "operation">;
  command: CommandIdentity;
  status: "compensated" | "reconciliation_required";
  failureCode: AccountErrorCode;
  result: unknown;
}

/** Shared 6-key finish-input shape for {@link terminateCommand} and {@link terminatePendingCommand},
 * which differ only in which state.ts primitive they call and their return type. */
function buildFinishInput({ scope, command, status, failureCode, result }: BuildFinishInputInput) {
  return {
    applicationId: scope.applicationId,
    operation: scope.operation,
    idempotencyKey: command.idempotencyKey,
    status,
    failureCode,
    resultJson: result === undefined ? null : buildCanonicalJson(result),
  };
}

interface TerminateCommandInput {
  db: Db;
  scope: Pick<CommandScope, "applicationId" | "operation">;
  command: CommandIdentity;
  status: "compensated" | "reconciliation_required";
  failureCode: AccountErrorCode;
  result?: unknown | undefined;
}

export function terminateCommand({ db, scope, command, status, failureCode, result }: TerminateCommandInput): void {
  finishAccountCommand(db, buildFinishInput({ scope, command, status, failureCode, result }));
}

interface TerminatePendingCommandInput {
  db: Db;
  scope: Pick<CommandScope, "applicationId" | "operation">;
  command: CommandIdentity;
  status: "compensated" | "reconciliation_required";
  failureCode: AccountErrorCode;
  result?: unknown | undefined;
}

export function terminatePendingCommand({
  db,
  scope,
  command,
  status,
  failureCode,
  result,
}: TerminatePendingCommandInput): boolean {
  return finishAccountCommandIfPending(db, buildFinishInput({ scope, command, status, failureCode, result }));
}

interface ReadCommandInput {
  db: Db;
  applicationId: string;
  operation: string;
  command: CommandIdentity;
}

export function readCommand({ db, applicationId, operation, command }: ReadCommandInput): AccountCommandRecord | null {
  return getAccountCommand({ db, applicationId, operation, idempotencyKey: command.idempotencyKey });
}
