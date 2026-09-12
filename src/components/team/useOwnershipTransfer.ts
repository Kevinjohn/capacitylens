import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { m } from "@/i18n";
import {
  teamAccessClient,
  type OwnershipTransferOutcomeView,
  type OwnershipTransferTerminalView,
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
  lastTerminal: OwnershipTransferTerminalView | null;
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
      // EITHER half failing is a failed read. Without the directory the card cannot name anybody or
      // offer a nominee, so silently rendering nothing would look exactly like "you have no
      // transfer and cannot start one" to the one person who can.
      error: projection.kind === "ok" && directory.kind === "ok" ? null : m.ownership_transfer_read_failed(),
    };
  } catch (cause) {
    // Offline, a dropped connection, the request timeout aborting. The user gets one sentence; the
    // operator needs the reason, because "it can't load" alone cannot tell them which of those it is.
    console.error("OwnershipTransferCard: ceremony read failed", cause);
    return { projection: null, members: null, error: m.ownership_transfer_read_failed() };
  }
}

/**
 * @param keepStale Keep what the server last said when a half fails. True while the card is only
 *   watching — the last answer is better evidence than nothing. FALSE after a command: the ceremony
 *   has just moved, so the old projection would offer controls at a revision the server will now
 *   refuse, and "I do not know" is the honest answer.
 */
function mergeCeremonyRead(
  previous: OwnershipTransferReadState,
  next: CeremonyRead,
  keepStale = true,
): OwnershipTransferReadState {
  return {
    ...previous,
    projection: next.projection ?? (keepStale ? previous.projection : null),
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
  forgetOutcome: (outcome: OwnershipTransferTerminalView | null) => void;
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
interface CommandAnswer {
  failure: string | null;
  /** The committed terminal outcome to explain, if the server committed one. Returned rather than
   *  stored directly, so it can be discarded with the rest of a superseded answer. */
  terminal: OwnershipTransferTerminalView | null;
  /** Did the roles actually move? Only completion changes the caller's own authority. */
  completed: boolean;
}

async function submit(perform: () => Promise<TeamAccessResult<OwnershipTransferOutcomeView>>): Promise<CommandAnswer> {
  try {
    const result = await perform();
    if (result.kind !== "ok") {
      return { failure: resolveRejectionMessage(result, m.ownership_transfer_command_failed()), ...NOTHING_MOVED };
    }
    return {
      failure: null,
      terminal: result.value.kind === "terminal" ? result.value : null,
      completed: result.value.kind === "applied" && result.value.request.state === "completed",
    };
  } catch (cause) {
    // A request that never came back may still have been applied, so the reason matters: this is the
    // one failure the user is told about without the server having said anything.
    console.error("OwnershipTransferCard: ceremony command failed", cause);
    return { failure: m.ownership_transfer_command_failed(), ...NOTHING_MOVED };
  }
}

const NOTHING_MOVED = { terminal: null, completed: false } as const;

export function useOwnershipTransfer(
  accountId: string | null,
  refreshAuth: () => Promise<void>,
): OwnershipTransferController {
  const [state, setState] = useState<OwnershipTransferReadState>(EMPTY_STATE);
  const [lastTerminal, setLastTerminal] = useState<OwnershipTransferTerminalView | null>(null);

  const beginRead = useLatestRead();
  useCeremonyRead({ accountId, beginRead, apply: setState, forgetOutcome: setLastTerminal });

  /**
   * Run one command, then reconcile every projection the caller's own authority depends on.
   *
   * Completion changes the caller's role — often downwards — so the membership cache, the account
   * summaries and the active slice are all stale the instant it succeeds, and only then.
   */
  const run = useCallback(
    async (perform: () => Promise<TeamAccessResult<OwnershipTransferOutcomeView>>): Promise<void> => {
      if (!accountId) return;
      const isLatest = beginRead();
      setState((previous) => ({ ...previous, busy: true, error: null }));
      setLastTerminal(null);
      const answer = await submit(perform);
      await refreshAuth().catch(() => undefined);
      // Only completion moves the roles, and reprojecting reloads the whole active slice. Doing it
      // after a decline or a cancel discards a large company's schedule for a command that cannot
      // have changed anyone's access. A failure here costs a re-read, not the user's attention.
      if (answer.completed) await reprojectAccess(accountId).catch(() => undefined);
      const next = await readCeremony(accountId);
      // Nothing from a superseded command is applied — not the projection, not the outcome, not
      // `busy`, which the company switch or the newer command already owns.
      if (!isLatest()) return;
      setLastTerminal(answer.terminal);
      setState((previous) => ({
        ...mergeCeremonyRead(previous, next, false),
        busy: false,
        error: answer.failure ?? next.error,
      }));
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
