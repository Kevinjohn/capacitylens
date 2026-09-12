import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { m } from "@/i18n";
import {
  teamAccessClient,
  type OwnershipTransferOutcomeView,
  type OwnershipTransferProjectionView,
  type TeamAccessResult,
  type TeamMember,
} from "../../account/teamAccessClient";
import { resolveRejectionMessage } from "../../account/accessResult";
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

/**
 * Read both halves of what the card shows.
 *
 * A failed half answers `null`, which the caller merges by KEEPING what it already had: the last
 * thing the server said is better evidence than nothing. A rejected request — offline, a dropped
 * connection, the request timeout aborting — is a failed read like any other and is reported, never
 * thrown: an exception here would leave the card loading or busy forever with nothing said.
 */
async function readCeremony(accountId: string): Promise<CeremonyRead> {
  try {
    const [projection, directory] = await Promise.all([
      teamAccessClient.readOwnershipTransfer(accountId),
      teamAccessClient.listMembers(accountId),
    ]);
    return {
      projection: projection.kind === "ok" ? projection.value : null,
      members: directory.kind === "ok" ? directory.value.members : null,
      error: projection.kind === "ok" ? null : m.ownership_transfer_read_failed(),
    };
  } catch {
    return { projection: null, members: null, error: m.ownership_transfer_read_failed() };
  }
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
 * Which company the card is showing RIGHT NOW.
 *
 * Every answer this hook waits for — the first read, a command, the re-read that follows it — can
 * outlive the company that asked for it. Applying a late answer would put one company's ceremony,
 * and the two people it names, on another company's screen, so each answer is checked against the
 * company still on screen before it is merged.
 */
function useShownAccount(accountId: string | null): (candidate: string) => boolean {
  const shown = useRef(accountId);
  useEffect(() => {
    shown.current = accountId;
  }, [accountId]);
  return useCallback((candidate: string) => shown.current === candidate, []);
}

/** Keep the card's projection in step with the company it is showing. */
function useCeremonyRead(
  accountId: string | null,
  isShown: (candidate: string) => boolean,
  apply: Dispatch<SetStateAction<OwnershipTransferReadState>>,
): void {
  useEffect(() => {
    if (!accountId) return;
    void (async () => {
      const next = await readCeremony(accountId);
      if (isShown(accountId)) apply((previous) => mergeCeremonyRead(previous, next));
    })();
  }, [accountId, isShown, apply]);
}

/**
 * Send one command and turn its answer into the sentence to show, if any.
 *
 * A committed terminal outcome is a success with an explanation, not a failure. Only a
 * SERVER-AUTHORED refusal may be shown verbatim ({@link resolveRejectionMessage}); "the response
 * did not decode" and "the write may or may not have landed" describe our uncertainty, so the
 * localised sentence is the better one. A rejected request never escapes: it would leave every
 * control disabled behind a `busy` that nothing clears.
 */
async function submit(
  perform: () => Promise<TeamAccessResult<OwnershipTransferOutcomeView>>,
  rememberTerminal: (outcome: OwnershipTransferOutcomeView) => void,
): Promise<string | null> {
  try {
    const result = await perform();
    if (result.kind === "ok") {
      if (result.value.kind === "terminal") rememberTerminal(result.value);
      return null;
    }
    return resolveRejectionMessage(result, m.ownership_transfer_command_failed());
  } catch {
    return m.ownership_transfer_command_failed();
  }
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

  const isShown = useShownAccount(accountId);
  useCeremonyRead(accountId, isShown, setState);

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
      const failure = await submit(perform, setLastTerminal);
      // Completion changes the caller's own role, so reconcile before re-reading. A failure here is
      // not the user's problem to solve — the command's own outcome is — so it only costs a re-read.
      await refreshAuth().catch(() => undefined);
      await reprojectAccess(accountId).catch(() => undefined);
      const next = await readCeremony(accountId);
      if (!isShown(accountId)) return;
      setState((previous) => ({ ...mergeCeremonyRead(previous, next), busy: false, error: failure ?? next.error }));
    },
    [accountId, isShown, refreshAuth],
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
