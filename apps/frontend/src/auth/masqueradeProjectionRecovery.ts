import type { MasqueradeState, MasqueradeStatus } from "@capacitylens/shared/domain/masquerade";
import { useStore } from "@/store/useStore";
import type { MasqueradeOfflineRecovery } from "./masqueradeOfflineRecovery";

export type FinishProjectionResult = { kind: "finished" } | { kind: "failed"; message: string };
export type RealProjectionResult =
  { kind: "restored" } | { kind: "active" } | { kind: "superseded" } | { kind: "failed" };

function identityFailureResult(isCurrent: () => boolean, onIdentityFailure: () => void): RealProjectionResult {
  if (!isCurrent()) return { kind: "superseded" };
  onIdentityFailure();
  return { kind: "failed" };
}

export function publishMasqueradeAccount(state: MasqueradeState, selectAccount = false): void {
  const account = useStore.getState().data.accounts.find((candidate) => candidate.id === state.accountId);
  useStore.getState().setAccountSummaries({
    list: account ? [{ id: account.id, name: account.name, role: state.effectiveRole }] : [],
    complete: account !== undefined,
  });
  if (selectAccount && useStore.getState().activeAccountId !== state.accountId) {
    useStore.getState().setActiveAccount(state.accountId);
  }
  useStore.getState().setActiveRole(state.effectiveRole, "resolved");
}

interface RestoreMasqueradeProjectionInput {
  state: MasqueradeState;
  readStatus: () => Promise<MasqueradeStatus>;
  isCurrent: () => boolean;
  publishActive: (status: Extract<MasqueradeStatus, { active: true }>) => void;
  offlineRecovery: MasqueradeOfflineRecovery;
  restoreProjection: (state: MasqueradeState) => Promise<FinishProjectionResult>;
  onIdentityFailure: () => void;
  onProjectionFailure: (message: string) => void;
}

/** Confirms server state before restoring real data or retaining the projected identity. */
export async function restoreMasqueradeProjection({
  state,
  readStatus,
  isCurrent,
  publishActive,
  offlineRecovery,
  restoreProjection,
  onIdentityFailure,
  onProjectionFailure,
}: RestoreMasqueradeProjectionInput): Promise<RealProjectionResult> {
  const status = await readStatus();
  if (!isCurrent()) return { kind: "superseded" };
  if (status.active) {
    publishActive(status);
    return { kind: "active" };
  }
  const isolated = offlineRecovery.isIsolated();
  if (isolated) offlineRecovery.beginRestorationWrites();
  let restored = !isolated;
  try {
    if (isolated) {
      const identityReady = await offlineRecovery.establishRealIdentity(isCurrent);
      if (!identityReady) return identityFailureResult(isCurrent, onIdentityFailure);
    }
    const finishResult = await restoreProjection(state);
    if (!isCurrent()) return { kind: "superseded" };
    if (finishResult.kind === "failed") {
      onProjectionFailure(finishResult.message);
      return { kind: "failed" };
    }
    if (isolated) offlineRecovery.finish(true);
    restored = true;
    return { kind: "restored" };
  } finally {
    if (isolated && !restored) offlineRecovery.finish(false);
  }
}
