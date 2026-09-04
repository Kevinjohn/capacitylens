import type { AccountFlows, ReconciliationRepairKind } from "@capacitylens/shared/account/ports";
import { getAccountCommandByIdForReconciliation } from "../commands";

type RepairCoordinate = "workspaceId" | "targetPrincipalId" | "provisionalPrincipalId" | "ceremonyId";

const repairRequirements: Readonly<
  Record<
    ReconciliationRepairKind,
    {
      operation?: Parameters<AccountFlows["reconcileCommand"]>[0]["operation"];
      coordinates: readonly RepairCoordinate[];
    }
  >
> = {
  "invitation-claim-committed": {
    operation: "invite-password-signup",
    coordinates: ["workspaceId", "targetPrincipalId", "provisionalPrincipalId"],
  },
  "provisional-principal-compensation-failed": {
    operation: "invite-password-signup",
    coordinates: ["targetPrincipalId", "provisionalPrincipalId"],
  },
  "password-reset-issued": {
    operation: "password-reset",
    coordinates: ["targetPrincipalId", "ceremonyId"],
  },
  "password-reset-outcome-unknown": {
    operation: "password-reset",
    coordinates: ["targetPrincipalId"],
  },
  "password-reset-revocation-failed": {
    operation: "password-reset",
    coordinates: ["targetPrincipalId", "ceremonyId"],
  },
  "session-revocation-outcome-unknown": {
    operation: "session-revocation",
    coordinates: ["targetPrincipalId"],
  },
  "stale-pending": { coordinates: [] },
  "operator-review": { coordinates: [] },
};

function isReconciliationRepairKind(value: string): value is ReconciliationRepairKind {
  return Object.hasOwn(repairRequirements, value);
}

export class CorruptAccountCommandStateError extends Error {
  readonly code = "ACCOUNT_COMMAND_STATE_CORRUPT";
  readonly commandId: string;

  constructor(commandId: string) {
    super(`Account command ${commandId} has corrupt reconciliation metadata; preserve the row for operator repair.`);
    this.name = "CorruptAccountCommandStateError";
    this.commandId = commandId;
  }
}

export function storedReconciliationRepair(
  row: NonNullable<ReturnType<typeof getAccountCommandByIdForReconciliation>>,
  operation: Parameters<AccountFlows["reconcileCommand"]>[0]["operation"],
): Record<string, unknown> & { kind: ReconciliationRepairKind } {
  // Released legacy rows may have no structured repair metadata. Preserve their explicit generic
  // operator-review fallback, but never equate present corrupt bytes with that legacy state.
  if (row.resultJson === null) return { kind: "operator-review" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.resultJson);
  } catch {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  const stored = parsed as Record<string, unknown>;
  if (typeof stored.kind !== "string" || stored.kind.trim() === "") {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  if (!isReconciliationRepairKind(stored.kind)) {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";
  const coordinates: readonly RepairCoordinate[] = [
    "workspaceId",
    "targetPrincipalId",
    "provisionalPrincipalId",
    "ceremonyId",
  ];
  for (const coordinate of coordinates) {
    const value = stored[coordinate];
    if (value !== undefined && value !== null && !nonEmptyString(value)) {
      throw new CorruptAccountCommandStateError(row.commandId);
    }
  }
  const requirement = repairRequirements[stored.kind];
  if (
    requirement &&
    ((requirement.operation !== undefined && requirement.operation !== operation) ||
      requirement.coordinates.some((coordinate) => !nonEmptyString(stored[coordinate])))
  ) {
    throw new CorruptAccountCommandStateError(row.commandId);
  }
  return { ...stored, kind: stored.kind };
}
