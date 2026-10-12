import { AccountContractError } from "@capacitylens/shared/account/errors";
import { SINGLE_COMPANY_CAP_MESSAGE } from "@capacitylens/shared/account/policy";
import type { MemberDirectoryEntry } from "@capacitylens/shared/account/ports";
import type { ActorContext } from "@capacitylens/shared/account/types";
import type { KeyedOperationLock } from "../KeyedOperationLock";
import type { LocalAccountAdminPort } from "../sqliteAccountAdminPort";

const WORKSPACE_ERASURE_SNAPSHOT_MAX_ATTEMPTS = 3;

/**
 * Rejects workspace provisioning when the current transaction’s authority check refuses it.
 * The caller owns the transaction and controls product and membership write ordering; this helper performs no writes.
 * @throws AccountContractError when authority refuses provisioning.
 */
export function assertWorkspaceProvisioningAllowedInTx(
  administration: LocalAccountAdminPort,
  input: {
    actor: ActorContext;
    multiWorkspace: boolean;
    bootstrapAuthorized: boolean;
    projectedWorkspaceCount?: number;
    commandId?: string;
  },
): void {
  const decision = administration.evaluateWorkspaceProvisioningAuthorityInTx({
    actor: input.actor,
    multiWorkspace: input.multiWorkspace,
    bootstrapAuthorized: input.bootstrapAuthorized,
    ...(input.projectedWorkspaceCount === undefined ? {} : { projectedWorkspaceCount: input.projectedWorkspaceCount }),
  });
  if (!decision.allowed) {
    throw new AccountContractError({
      code: "FORBIDDEN",
      message: decision.reason === "single-workspace-cap" ? SINGLE_COMPANY_CAP_MESSAGE : "Forbidden.",
      retryable: false,
      ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    });
  }
}

/** The name a directory entry sorts under: display name, else email, else the principal id, the
 * same fallback chain the UI labels the row with, so the rendered list is visibly in order even
 * for a member who signed up without a name. */
export function resolveDirectorySortName(entry: MemberDirectoryEntry): string {
  const principal = entry.principal;
  const displayName = principal?.displayName?.trim();
  if (displayName) return displayName;
  const email = principal?.email?.trim();
  if (email) return email;
  return entry.membership.principalId;
}

/**
 * Maps session identity and assurance details to the actor context used by account commands.
 */
export function buildActorContextFromSession(
  input: {
    id: string;
    principal: { id: string };
    freshUntil: string | null;
    assurance: "trusted-local" | "password" | "federated";
  },
  now = Date.now(),
): ActorContext {
  return {
    principalId: input.principal.id,
    sessionId: input.id,
    assurance: input.assurance,
    fresh: input.freshUntil !== null && Date.parse(input.freshUntil) > now,
  };
}

interface WithMembershipSnapshotRetryInput<T> {
  lock: KeyedOperationLock;
  currentPrincipalIds: () => readonly string[];
  lockKeysFor: (principalIds: readonly string[]) => readonly string[];
  run: () => Promise<T>;
  onAttemptsExhausted: () => never;
}

/**
 * Runs an operation while holding locks for a stable workspace membership snapshot.
 * Retries with newly observed principals, then calls onAttemptsExhausted if the snapshot remains unstable.
 * Propagates lock, callback, and exhaustion failures; callers supply workspace and principal lock keys.
 */
export async function withMembershipSnapshotRetry<T>({
  lock,
  currentPrincipalIds,
  lockKeysFor,
  run,
  onAttemptsExhausted,
}: WithMembershipSnapshotRetryInput<T>): Promise<T> {
  const attempt = async (principalIds: readonly string[], attemptNumber: number): Promise<T> => {
    const locked = new Set(principalIds);
    const result = await lock.withKeys(
      lockKeysFor(principalIds),
      async (): Promise<{ kind: "retry"; principalIds: readonly string[] } | { kind: "done"; value: T }> => {
        // The membership snapshot was taken synchronously before lock acquisition. A mutation
        // that already held the workspace lock may have added a principal while we waited.
        // Re-snapshot under the workspace lock and retry with the full key set before running;
        // this keeps identity-admin operations serialized with every principal in scope.
        const current = currentPrincipalIds();
        if (current.some((principalId) => !locked.has(principalId))) {
          return { kind: "retry", principalIds: current };
        }
        return { kind: "done", value: await run() };
      },
    );
    if (result.kind === "done") return result.value;
    if (attemptNumber >= WORKSPACE_ERASURE_SNAPSHOT_MAX_ATTEMPTS) onAttemptsExhausted();
    return attempt(result.principalIds, attemptNumber + 1);
  };
  return attempt(currentPrincipalIds(), 1);
}
