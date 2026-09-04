import { AccountContractError } from "@capacitylens/shared/account/errors";
import { SINGLE_COMPANY_CAP_MESSAGE } from "@capacitylens/shared/account/policy";
import type { MemberDirectoryEntry } from "@capacitylens/shared/account/ports";
import type { ActorContext } from "@capacitylens/shared/account/types";
import { KeyedOperationLock } from "../operationLock";
import type { LocalAccountAdminPort } from "../sqliteAccountAdminPort";

const WORKSPACE_ERASURE_SNAPSHOT_MAX_ATTEMPTS = 3;

/** Shared single-company-cap gate for provisionWorkspace's tx callback and
 * provisionWorkspaceInExistingTransaction: evaluate provisioning authority in the current
 * transaction and throw the same FORBIDDEN shape on refusal. Split from the Owner-membership
 * provisioning call (unlike this check, that write's position relative to product-data creation is
 * externally observable — audit/outbox row ordering — so provisionWorkspace's tx callback keeps its
 * original decision -> provisionProductData() -> provisionOwnerMembershipInTx interleaving instead
 * of both steps being fused into one helper call). */
export function assertWorkspaceProvisioningAllowedInTx(
  administration: LocalAccountAdminPort,
  params: {
    actor: ActorContext;
    multiWorkspace: boolean;
    bootstrapAuthorized: boolean;
    projectedWorkspaceCount?: number;
    commandId?: string;
  },
): void {
  const decision = administration.evaluateWorkspaceProvisioningAuthorityInTx({
    actor: params.actor,
    multiWorkspace: params.multiWorkspace,
    bootstrapAuthorized: params.bootstrapAuthorized,
    projectedWorkspaceCount: params.projectedWorkspaceCount,
  });
  if (!decision.allowed) {
    throw new AccountContractError({
      code: "FORBIDDEN",
      message: decision.reason === "single-workspace-cap" ? SINGLE_COMPANY_CAP_MESSAGE : "Forbidden.",
      retryable: false,
      commandId: params.commandId,
    });
  }
}

/** The name a directory entry sorts under: display name, else email, else the principal id — the
 *  same fallback chain the UI labels the row with, so the rendered list is visibly in order even
 *  for a member who signed up without a name. */
export function directorySortName(entry: MemberDirectoryEntry): string {
  const principal = entry.principal;
  return principal?.displayName?.trim() || principal?.email?.trim() || entry.membership.principalId;
}

export function actorContextFromSession(
  input: {
    id: string;
    principal: { id: string };
    freshUntil: string | null;
    assurance: "trusted-local" | "password" | "mfa" | "federated";
  },
  now = Date.now(),
): ActorContext {
  return {
    principalId: input.principal.id,
    sessionId: input.id,
    assurance: input.assurance,
    fresh: input.freshUntil !== null && Date.parse(input.freshUntil) > now,
    mfaSatisfied: input.assurance === "mfa" || input.assurance === "federated" || input.assurance === "trusted-local",
  };
}

/** Shared scaffold for the membership-snapshot lock-retry algorithm duplicated by eraseWorkspace's
 * `eraseWithMembershipSnapshot` and withWorkspaceErasureLocks' `runWithSnapshot`: snapshot principal
 * ids, acquire locks over them, re-snapshot under lock in case a mutation slipped in while waiting,
 * and retry with the enlarged set — bounded by WORKSPACE_ERASURE_SNAPSHOT_MAX_ATTEMPTS. Callers keep
 * their own exhausted-retries error (one throws with commandId, one without — see call sites), so
 * that error is supplied as a factory rather than unified here. */
export async function withMembershipSnapshotRetry<T>(
  lock: KeyedOperationLock,
  currentPrincipalIds: () => readonly string[],
  lockKeysFor: (principalIds: readonly string[]) => readonly string[],
  run: () => Promise<T>,
  onAttemptsExhausted: () => never,
): Promise<T> {
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
