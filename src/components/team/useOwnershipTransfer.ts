import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { m } from "@/i18n";
import { teamAccessClient } from "@/account/teamAccessClient";
import type {
  OwnershipTransferOutcomeView,
  OwnershipTransferTerminalView,
  OwnershipTransferProjectionView,
  TeamAccessResult,
  TeamMember,
} from "@/account/teamAccessClient";
import { resolveRejectionMessage } from "@/account/accessResult";
import type { OwnershipTransferStep } from "@/account/accountClient";
import { reprojectAccess } from "@/auth/reprojectAccess";
import { useStore } from "@/store/useStore";

// Re-read the server projection after commands because other participants and expiry processing can change the ceremony outside this screen.

interface OwnershipTransferReadState {
  projection: OwnershipTransferProjectionView | null;
  members: readonly TeamMember[];
  busy: boolean;
  error: string | null;
}

/** Current transfer record, loading status, and latest outcome. */
export interface OwnershipTransferState extends OwnershipTransferReadState {
  /** Loading remains distinct from an authoritative empty projection until the first read succeeds or reports an error. */
  loading: boolean;
}

interface CommandInput {
  requestId: string;
  step: OwnershipTransferStep;
  expectedRevision: string;
}

/** Ownership transfer state and operations exposed to the card. */
export interface OwnershipTransferController extends OwnershipTransferState {
  refresh(): Promise<void>;
  nominate(targetPrincipalId: string): Promise<void>;
  command(input: CommandInput): Promise<void>;
  /** The committed terminal outcome of the last command, if it had one. Cleared by the next
   * command, so a stale explanation cannot outlive the thing it explains. */
  lastTerminal: OwnershipTransferTerminalView | null;
}

const EMPTY_MEMBERS: readonly TeamMember[] = [];

interface CeremonyRead {
  projection: OwnershipTransferProjectionView | null;
  members: readonly TeamMember[] | null;
  error: string | null;
}

// Failed reads return a visible error and nullable projections rather than rejecting the card lifecycle. Callers may retain stale state while observing, but a post-command refresh discards stale controls.
async function readCeremony(accountId: string): Promise<CeremonyRead> {
  try {
    const [projection, directory] = await Promise.all([
      teamAccessClient.readOwnershipTransfer(accountId),
      teamAccessClient.listMembers(accountId),
    ]);
    return {
      projection: projection.kind === "ok" ? projection.value : null,
      members: directory.kind === "ok" ? directory.value.members : null,
      // A failed directory read must remain visible because an empty card would falsely imply there is no ownership action available.
      error: projection.kind === "ok" && directory.kind === "ok" ? null : m.ownership_transfer_read_failed(),
    };
  } catch (cause) {
    // Report the safe user message and log the read failure so operators can distinguish transport and timeout causes.
    console.error("OwnershipTransferCard: ceremony read failed", cause);
    return { projection: null, members: null, error: m.ownership_transfer_read_failed() };
  }
}

type MergeCeremonyReadOptions = { previous: OwnershipTransferReadState; next: CeremonyRead; keepStale?: boolean };
// Retain the previous projection during passive refresh failure; after a command, discard stale controls because their revision may have changed.
function mergeCeremonyRead({ previous, next, keepStale = true }: MergeCeremonyReadOptions): OwnershipTransferReadState {
  return {
    ...previous,
    projection: next.projection ?? (keepStale ? previous.projection : null),
    members: next.members ?? previous.members,
    error: next.error,
  };
}

// Match both account and request generation so an older same-company read cannot restore stale ceremony controls.
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

// Clear projections on account change so a failed new read cannot expose the previous company's participants.
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

    forgetOutcome(null);
    if (!accountId) return;
    void (async () => {
      const next = await readCeremony(accountId);
      if (isLatest()) apply((previous) => mergeCeremonyRead({ previous: previous, next: next }));
    })();
  }, [accountId, beginRead, apply, forgetOutcome]);
}

// A committed terminal response is a successful outcome to explain; refusals use safe server copy, while ambiguous responses use local recovery wording. Failures must release the card's busy state.
interface CommandAnswer {
  failure: string | null;
  /** The committed terminal outcome to explain, if the server committed one. Returned rather than
   * stored directly, so it can be discarded with the rest of a superseded answer. */
  terminal: OwnershipTransferTerminalView | null;
  /** Did the roles actually move? Only completion changes the caller's own authority. */
  completed: boolean;
  uncertain: boolean;
}

async function submit(perform: () => Promise<TeamAccessResult<OwnershipTransferOutcomeView>>): Promise<CommandAnswer> {
  try {
    const result = await perform();
    if (result.kind !== "ok") {
      return {
        failure: resolveRejectionMessage(result, m.ownership_transfer_command_failed()),
        ...NOTHING_MOVED,
        uncertain: result.kind === "unknown" || result.kind === "invalid",
      };
    }
    return {
      failure: null,
      terminal: result.value.kind === "terminal" ? result.value : null,
      completed: result.value.kind === "applied" && result.value.request.state === "completed",
      uncertain: false,
    };
  } catch (cause) {
    // A request that never came back may still have been applied, so the reason matters: this is the
    // one failure the user is told about without the server having said anything.
    console.error("OwnershipTransferCard: ceremony command failed", cause);
    return { failure: m.ownership_transfer_command_failed(), ...NOTHING_MOVED, uncertain: true };
  }
}

const NOTHING_MOVED = { terminal: null, completed: false } as const;

async function refreshCallerAccess(
  accountId: string,
  currentAccount: RefObject<string | null>,
  refreshAuth: () => Promise<void>,
): Promise<boolean> {
  try {
    await refreshAuth();
    if (currentAccount.current !== accountId) return true;
    if (await reprojectAccess(accountId)) return true;
  } catch (cause) {
    // Log failed access refresh so a confirmed transfer is not silently followed by stale authorization state.
    console.error("OwnershipTransferCard: access refresh failed", cause);
  }
  if (useStore.getState().activeAccountId === accountId) {
    useStore.getState().setActiveAccount(null);
    useStore.getState().setNotice(m.settings_members_access_refresh_failed(), "error");
  }
  return false;
}

interface TransferCommandInput {
  accountId: string | null;
  beginRead: () => () => boolean;
  currentAccount: RefObject<string | null>;
  apply: Dispatch<SetStateAction<OwnershipTransferReadState>>;
  setLastTerminal: (outcome: OwnershipTransferTerminalView | null) => void;
  refreshAuth: () => Promise<void>;
}

type RunTransferCommandOptions = {
  perform: () => Promise<TeamAccessResult<OwnershipTransferOutcomeView>>;
  mayChangeCallerAccess?: boolean;
};

function useTransferCommand({
  accountId,
  beginRead,
  currentAccount,
  apply,
  setLastTerminal,
  refreshAuth,
}: TransferCommandInput) {
  const issuedCommand = useRef(0);
  return useCallback(
    async ({ perform, mayChangeCallerAccess = false }: RunTransferCommandOptions): Promise<void> => {
      if (!accountId) return;
      const commandId = ++issuedCommand.current;
      const ownsCommand = () => issuedCommand.current === commandId && currentAccount.current === accountId;
      beginRead();
      apply((previous) => ({ ...previous, busy: true, error: null }));
      setLastTerminal(null);
      const answer = await submit(perform);
      if (currentAccount.current !== accountId) return;
      if (mayChangeCallerAccess && (answer.completed || answer.uncertain)) {
        if (!(await refreshCallerAccess(accountId, currentAccount, refreshAuth))) return;
      }
      if (!ownsCommand()) return;
      // A read from reopening the dialog may have overtaken the command. Once it settles, clear
      // this command's busy state and issue a fresh read after the possible server write.
      apply((previous) => ({ ...previous, busy: false }));
      const isLatest = beginRead();
      const next = await readCeremony(accountId);
      if (!isLatest() || !ownsCommand()) return;
      setLastTerminal(answer.terminal);
      apply((previous) => ({
        ...mergeCeremonyRead({ previous: previous, next: next, keepStale: false }),
        busy: false,
        error: answer.failure ?? next.error,
      }));
    },
    [accountId, beginRead, currentAccount, apply, setLastTerminal, refreshAuth],
  );
}

/** Loads and mutates ownership transfers for the requested account. */
export function useOwnershipTransfer(
  accountId: string | null,
  refreshAuth: () => Promise<void>,
): OwnershipTransferController {
  const [state, setState] = useState<OwnershipTransferReadState>(EMPTY_STATE);
  const [lastTerminal, setLastTerminal] = useState<OwnershipTransferTerminalView | null>(null);

  const beginRead = useLatestRead();
  const currentAccount = useRef(accountId);
  useLayoutEffect(() => {
    currentAccount.current = accountId;
  }, [accountId]);
  useCeremonyRead({ accountId, beginRead, apply: setState, forgetOutcome: setLastTerminal });

  const refresh = useCallback(async (): Promise<void> => {
    if (!accountId) return;
    const isLatest = beginRead();
    const next = await readCeremony(accountId);
    if (isLatest() && currentAccount.current === accountId)
      setState((previous) => mergeCeremonyRead({ previous: previous, next: next }));
  }, [accountId, beginRead]);

  // Completion can change the caller's role, including when its response is uncertain.
  const run = useTransferCommand({
    accountId,
    beginRead,
    currentAccount,
    apply: setState,
    setLastTerminal,
    refreshAuth,
  });

  const nominate = useCallback(
    async (targetPrincipalId: string): Promise<void> => {
      const live = state.projection?.live ?? null;
      await run({
        perform: () =>
          teamAccessClient.initiateOwnershipTransfer({
            workspaceId: accountId ?? "",
            targetPrincipalId,
            // Naming the predecessor is what makes replacement atomic: if it moved since this card
            // read it, the server refuses rather than replacing something else.
            ...(live ? { replaces: { requestId: live.id, revision: live.revision } } : {}),
          }),
      });
    },
    [accountId, run, state.projection],
  );

  const command = useCallback(
    async ({ requestId, step, expectedRevision }: CommandInput): Promise<void> => {
      await run({
        perform: () =>
          teamAccessClient.commandOwnershipTransfer({
            workspaceId: accountId ?? "",
            requestId,
            step,
            expectedRevision,
          }),
        mayChangeCallerAccess: step === "complete",
      });
    },
    [accountId, run],
  );

  const loading = accountId !== null && state.projection === null && state.error === null;
  return { ...state, loading, lastTerminal, refresh, nominate, command };
}
