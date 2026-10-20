import type { MasqueradeState, MasqueradeStatus } from "@capacitylens/shared/domain/masquerade";
import { useStore } from "@/store/useStore";

export type FinishProjectionResult = { kind: "finished" } | { kind: "failed"; message: string };
export type RealProjectionResult =
  { kind: "restored" } | { kind: "active" } | { kind: "superseded" } | { kind: "failed" };

export function publishMasqueradeAccount(state: MasqueradeState, selectAccount = false): void {
  const account = useStore.getState().data.accounts.find((candidate) => candidate.id === state.accountId);
  useStore.getState().setAccountSummaries({
    list: account ? [{ id: account.id, name: account.name, role: state.effectiveRole }] : [],
    complete: account !== undefined,
  });
  if (selectAccount && account && useStore.getState().activeAccountId !== state.accountId) {
    useStore.getState().setActiveAccount(state.accountId);
  }
  useStore.getState().setActiveRole(state.effectiveRole, "resolved");
}

interface RestoreMasqueradeProjectionInput {
  state: MasqueradeState;
  readStatus: () => Promise<MasqueradeStatus>;
  isCurrent: () => boolean;
  publishActive: (status: Extract<MasqueradeStatus, { active: true }>) => void;
  restoreProjection: (state: MasqueradeState) => Promise<FinishProjectionResult>;
  onProjectionFailure: (message: string) => void;
}

/** Confirms server state before restoring real data or retaining the projected identity. */
export async function restoreMasqueradeProjection({
  state,
  readStatus,
  isCurrent,
  publishActive,
  restoreProjection,
  onProjectionFailure,
}: RestoreMasqueradeProjectionInput): Promise<RealProjectionResult> {
  const status = await readStatus();
  if (!isCurrent()) return { kind: "superseded" };
  if (status.active) {
    publishActive(status);
    return { kind: "active" };
  }
  const finishResult = await restoreProjection(state);
  if (!isCurrent()) return { kind: "superseded" };
  if (finishResult.kind === "failed") {
    onProjectionFailure(finishResult.message);
    return { kind: "failed" };
  }
  return { kind: "restored" };
}
