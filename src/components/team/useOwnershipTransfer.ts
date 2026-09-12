import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { m } from "@/i18n";
import {
  teamAccessClient,
  type OwnershipTransferOutcomeView,
  type OwnershipTransferProjectionView,
  type TeamAccessResult,
  type TeamMember,
} from "../../account/teamAccessClient";
import type { OwnershipTransferStep } from "../../account/accountClient";
import { reprojectAccess } from "../../auth/reprojectAccess";

/**
 * The ownership transfer ceremony as one screen's worth of state.
 *
 * Every command is answered by re-reading the server's projection rather than by patching local
 * state: the ceremony spans sessions and days, several of its outcomes are written by OTHER people
 * or by the server itself (an expiry, an invalidation caused by a role change), and a card that
 * advanced its own state would confidently show a ceremony that no longer exists.
 */

interface OwnershipTransferReadState {
  projection: OwnershipTransferProjectionView | null;
  members: readonly TeamMember[];
  busy: boolean;
  error: string | null;
}

export interface OwnershipTransferState extends OwnershipTransferReadState {
  /** The first read is still in flight. Derived, not stored: a projection is an object once the
   *  server has answered, so "no projection yet and no error" IS the loading state — and deriving
   *  it keeps the card from briefly claiming there is no transfer. */
  loading: boolean;
}

interface CommandInput {
  requestId: string;
  step: OwnershipTransferStep;
  expectedRevision: string;
}

export interface OwnershipTransferController extends OwnershipTransferState {
  nominate(targetPrincipalId: string): Promise<void>;
  command(input: CommandInput): Promise<void>;
  /** The committed terminal outcome of the last command, if it had one. Cleared by the next
   *  command, so a stale explanation cannot outlive the thing it explains. */
  lastTerminal: OwnershipTransferOutcomeView | null;
}

const EMPTY_MEMBERS: readonly TeamMember[] = [];

interface CeremonyRead {
  projection: OwnershipTransferProjectionView | null;
  members: readonly TeamMember[] | null;
  error: string | null;
}

/** Read both halves of what the card shows. A failed half answers `null`, which the caller merges
 *  by KEEPING what it already had: the last thing the server said is better evidence than nothing. */
async function readCeremony(accountId: string): Promise<CeremonyRead> {
  const [projection, directory] = await Promise.all([
    teamAccessClient.readOwnershipTransfer(accountId),
    teamAccessClient.listMembers(accountId),
  ]);
  return {
    projection: projection.kind === "ok" ? projection.value : null,
    members: directory.kind === "ok" ? directory.value.members : null,
    error: projection.kind === "ok" ? null : m.ownership_transfer_read_failed(),
  };
}

function mergeCeremonyRead(previous: OwnershipTransferReadState, next: CeremonyRead): OwnershipTransferReadState {
  return {
    ...previous,
    projection: next.projection ?? previous.projection,
    members: next.members ?? previous.members,
    error: next.error,
  };
}

/**
 * Keep the card's projection in step with the company it is showing.
 *
 * The company can change under an open card, so a late answer is applied only while it is still the
 * CURRENT one: a generation counter, not the promise's own resolution order, decides that.
 */
function useCeremonyRead(accountId: string | null, apply: Dispatch<SetStateAction<OwnershipTransferReadState>>): void {
  const generation = useRef(0);
  useEffect(() => {
    if (!accountId) return;
    const requested = ++generation.current;
    void (async () => {
      const next = await readCeremony(accountId);
      if (generation.current === requested) apply((previous) => mergeCeremonyRead(previous, next));
    })();
  }, [accountId, apply]);
}

export function useOwnershipTransfer(
  accountId: string | null,
  refreshAuth: () => Promise<void>,
): OwnershipTransferController {
  const [state, setState] = useState<OwnershipTransferReadState>({
    projection: null,
    members: EMPTY_MEMBERS,
    busy: false,
    error: null,
  });
  const [lastTerminal, setLastTerminal] = useState<OwnershipTransferOutcomeView | null>(null);

  useCeremonyRead(accountId, setState);

  /**
   * Run one command, then reconcile every projection the caller's own authority depends on.
   *
   * Completion changes the caller's role — often downwards — so the membership cache, the account
   * summaries and the active slice are all stale the instant it succeeds. Reconciling on EVERY
   * success, not just completion, costs one round trip and removes a whole class of "the UI still
   * thinks I am the Owner" states.
   */
  const run = useCallback(
    async (perform: () => Promise<TeamAccessResult<OwnershipTransferOutcomeView>>): Promise<void> => {
      if (!accountId) return;
      setState((previous) => ({ ...previous, busy: true, error: null }));
      setLastTerminal(null);
      const result = await perform();
      if (result.kind === "ok" && result.value.kind === "terminal") setLastTerminal(result.value);
      const failure = result.kind === "ok" ? null : (result.message ?? m.ownership_transfer_command_failed());
      await refreshAuth();
      await reprojectAccess(accountId);
      const next = await readCeremony(accountId);
      setState((previous) => ({ ...mergeCeremonyRead(previous, next), busy: false, error: failure ?? next.error }));
    },
    [accountId, refreshAuth],
  );

  const nominate = useCallback(
    async (targetPrincipalId: string): Promise<void> => {
      const live = state.projection?.live ?? null;
      await run(() =>
        teamAccessClient.initiateOwnershipTransfer({
          workspaceId: accountId ?? "",
          targetPrincipalId,
          // Naming the predecessor is what makes replacement atomic: if it moved since this card
          // read it, the server refuses rather than replacing something else.
          ...(live ? { replaces: { requestId: live.id, revision: live.revision } } : {}),
        }),
      );
    },
    [accountId, run, state.projection],
  );

  const command = useCallback(
    async ({ requestId, step, expectedRevision }: CommandInput): Promise<void> => {
      await run(() =>
        teamAccessClient.commandOwnershipTransfer({ workspaceId: accountId ?? "", requestId, step, expectedRevision }),
      );
    },
    [accountId, run],
  );

  const loading = accountId !== null && state.projection === null && state.error === null;
  return { ...state, loading, lastTerminal, nominate, command };
}
