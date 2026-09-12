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
  } catch (cause) {
    // Offline, a dropped connection, the request timeout aborting. The user gets one sentence; the
    // operator needs the reason, because "it can't load" alone cannot tell them which of those it is.
    console.error("OwnershipTransferCard: ceremony read failed", cause);
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
 * Is the answer we are holding still the one the card asked for LAST?
 *
 * Every answer this hook waits for — the first read, a command, the re-read that follows it — can
 * be overtaken. Comparing companies is not enough: two reads of the SAME company can resolve out of
 * order, and applying the older one puts a nomination back on screen that has already been accepted,
 * with a revision every later click would be refused for. A counter answers both cases.
 */
function useLatestRead(): () => () => boolean {
  const issued = useRef(0);
  return useCallback(() => {
    const mine = ++issued.current;
    return () => issued.current === mine;
  }, []);
}

const EMPTY_STATE: OwnershipTransferReadState = {
  projection: null,
  members: EMPTY_MEMBERS,
  busy: false,
  error: null,
};

/**
 * Keep the card's projection in step with the company it is showing.
 *
 * Changing company empties the card FIRST, before the new read lands. Merging keeps what the server
 * last said, which is right within one company and wrong across two: it would leave one company's
 * nomination, and the two people it names, on another company's screen if the new read failed.
 */
interface CeremonyReadInput {
  accountId: string | null;
  beginRead: () => () => boolean;
  apply: Dispatch<SetStateAction<OwnershipTransferReadState>>;
  forgetOutcome: (outcome: OwnershipTransferOutcomeView | null) => void;
}

function useCeremonyRead({ accountId, beginRead, apply, forgetOutcome }: CeremonyReadInput): void {
  useEffect(() => {
    const isLatest = beginRead();
    apply(EMPTY_STATE);
    // The explanation of a command's outcome belongs to the company it happened in, and to nobody
    // else's team page.
    forgetOutcome(null);
    if (!accountId) return;
    void (async () => {
      const next = await readCeremony(accountId);
      if (isLatest()) apply((previous) => mergeCeremonyRead(previous, next));
    })();
  }, [accountId, beginRead, apply, forgetOutcome]);
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
  } catch (cause) {
    // A request that never came back may still have been applied, so the reason matters: this is the
    // one failure the user is told about without the server having said anything.
    console.error("OwnershipTransferCard: ceremony command failed", cause);
    return m.ownership_transfer_command_failed();
  }
}

export function useOwnershipTransfer(
  accountId: string | null,
  refreshAuth: () => Promise<void>,
): OwnershipTransferController {
  const [state, setState] = useState<OwnershipTransferReadState>(EMPTY_STATE);
  const [lastTerminal, setLastTerminal] = useState<OwnershipTransferOutcomeView | null>(null);

  const beginRead = useLatestRead();
  useCeremonyRead({ accountId, beginRead, apply: setState, forgetOutcome: setLastTerminal });

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
      const isLatest = beginRead();
      setState((previous) => ({ ...previous, busy: true, error: null }));
      setLastTerminal(null);
      const failure = await submit(perform, setLastTerminal);
      // Completion changes the caller's own role, so reconcile before re-reading. A failure here is
      // not the user's problem to solve — the command's own outcome is — so it only costs a re-read.
      await refreshAuth().catch(() => undefined);
      await reprojectAccess(accountId).catch(() => undefined);
      const next = await readCeremony(accountId);
      // `busy` is this card's own state and is always released — a command overtaken by a company
      // switch must not leave every control disabled — but a superseded answer is never merged.
      setState((previous) =>
        isLatest()
          ? { ...mergeCeremonyRead(previous, next), busy: false, error: failure ?? next.error }
          : { ...previous, busy: false },
      );
    },
    [accountId, beginRead, refreshAuth],
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
