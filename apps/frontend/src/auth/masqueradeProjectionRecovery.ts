import type { MasqueradeState, MasqueradeStatus } from '@capacitylens/shared/domain/masquerade';
import type { StoreState } from '@/store/types';

export type FinishProjectionResult = { kind: 'finished' } | { kind: 'failed'; message: string };
export type RealProjectionResult =
  { kind: 'restored' } | { kind: 'active' } | { kind: 'superseded' } | { kind: 'failed' };

export function publishMasqueradeAccount(store: StoreState, state: MasqueradeState): void {
  const account = store.data.accounts.find((candidate) => candidate.id === state.companyId);
  store.setAccountSummaries({
    list: account ? [{ id: account.id, name: account.name, role: state.effectiveRole }] : [],
    complete: account !== undefined,
  });
  store.setActiveRole(state.effectiveRole, 'resolved', state.permissions);
}

interface RestoreMasqueradeProjectionInput {
  state: MasqueradeState;
  adoptContextToken: (token: string | null) => void;
  readStatus: () => Promise<MasqueradeStatus>;
  isCurrent: () => boolean;
  publishActive: (status: Extract<MasqueradeStatus, { active: true }>) => void;
  restoreProjection: (state: MasqueradeState) => Promise<FinishProjectionResult>;
  onProjectionFailure: (message: string) => void;
}

/** Confirms server state before restoring real data or retaining the projected identity. */
export async function restoreMasqueradeProjection({
  state,
  adoptContextToken,
  readStatus,
  isCurrent,
  publishActive,
  restoreProjection,
  onProjectionFailure,
}: RestoreMasqueradeProjectionInput): Promise<RealProjectionResult> {
  const status = await readStatus();
  if (!isCurrent()) return { kind: 'superseded' };
  adoptContextToken(status.contextToken);
  if (status.active) {
    publishActive(status);
    return { kind: 'active' };
  }
  const finishResult = await restoreProjection(state);
  if (!isCurrent()) return { kind: 'superseded' };
  if (finishResult.kind === 'failed') {
    onProjectionFailure(finishResult.message);
    return { kind: 'failed' };
  }
  return { kind: 'restored' };
}
