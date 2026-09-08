import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { m } from "@/i18n";
import { resolveErrorMessage } from "../../lib/errorMessage";
import {
  teamAccessClient,
  type TeamAccessResult,
  type TeamDirectory,
  type TeamInvitation,
  type TeamMember,
} from "../../account/teamAccessClient";
import type { FieldError } from "../../hooks/useFieldError";

// Frozen module-scope empties for the "this account has not loaded yet" projections below. A fresh
// `[]` per render is a NEW identity every time, which re-runs any consumer effect that lists the
// list in its dependencies — the invite-expiry alarm in MembersSection is exactly that shape.
const NO_INVITES: readonly TeamInvitation[] = Object.freeze([]);

interface TeamDirectoryOptions {
  enabled: boolean;
  activeAccountId: string | null;
  offlineReadOnly: boolean;
  fail: FieldError["fail"];
  onInvitesLoaded?: (invites: TeamInvitation[]) => void;
}

interface DirectoryState {
  accountId: string | null;
  members: TeamMember[] | null;
  invites: TeamInvitation[];
  signInTrackingEnabled: boolean;
  gate: "loading" | "shown" | "hidden" | "error";
}

type SetDirectory = Dispatch<SetStateAction<DirectoryState>>;

interface DirectoryLoad {
  accountId: string;
  hadAuthorizedDirectory: boolean;
  current: () => boolean;
  setDirectory: SetDirectory;
  fail: FieldError["fail"];
  onInvitesLoaded: TeamDirectoryOptions["onInvitesLoaded"];
}

function emptyDirectory(accountId: string | null, gate: DirectoryState["gate"]): DirectoryState {
  return { accountId, members: null, invites: [], signInTrackingEnabled: false, gate };
}

function failureMessage<T>(result: TeamAccessResult<T>, fallback: string): string {
  return result.kind === "rejected" && result.message ? result.message : fallback;
}

async function loadMembers({
  accountId,
  hadAuthorizedDirectory,
  current,
  setDirectory,
  fail,
}: DirectoryLoad): Promise<boolean> {
  const result = await teamAccessClient.listMembers(accountId);
  if (result.kind === "rejected" && result.status === 403) {
    if (!current()) return false;
    if (hadAuthorizedDirectory) {
      setDirectory((previous) => ({ ...previous, gate: "error" }));
      fail(null, m.settings_members_err_access_changed());
    } else {
      setDirectory(emptyDirectory(accountId, "hidden"));
    }
    return false;
  }
  if (result.kind === "invalid") throw new Error("The server returned an invalid members response.");
  if (result.kind !== "ok") {
    if (!current()) return false;
    setDirectory(emptyDirectory(accountId, "error"));
    fail(null, failureMessage(result, m.settings_members_err_load({ status: result.status })));
    return false;
  }
  if (!current()) return false;
  setDirectory((previous) => ({
    accountId,
    members: result.value.members,
    signInTrackingEnabled: result.value.signInTrackingEnabled,
    // Preserve the last authoritative invitation list while a same-account refresh is in
    // flight. On an account switch, the old list is both hidden by the account key below and
    // discarded here before this account's separately-authorized invite read completes.
    invites: previous.accountId === accountId ? previous.invites : [],
    gate: "shown",
  }));
  return true;
}

async function loadInvitations(
  accountId: string,
  current: () => boolean,
  fail: FieldError["fail"],
): Promise<TeamInvitation[] | null> {
  const result = await teamAccessClient.listInvitations(accountId);
  if (result.kind === "invalid") throw new Error("The server returned an invalid invites response.");
  if (result.kind !== "ok") {
    if (current()) fail(null, failureMessage(result, m.settings_invites_err_load({ status: result.status })));
    return null;
  }
  return current() ? result.value : null;
}

async function loadDirectory(load: DirectoryLoad): Promise<void> {
  let membersLoaded = false;
  try {
    membersLoaded = await loadMembers(load);
    if (!membersLoaded) return;
    const invites = await loadInvitations(load.accountId, load.current, load.fail);
    if (invites === null) return;
    load.setDirectory((previous) => (previous.accountId === load.accountId ? { ...previous, invites } : previous));
    load.onInvitesLoaded?.(invites);
  } catch (error) {
    if (!load.current()) return;
    if (!membersLoaded) load.setDirectory(emptyDirectory(load.accountId, "error"));
    load.fail(null, m.settings_err_server({ error: resolveErrorMessage(error) }));
  }
}

function useDirectoryRead({ enabled, activeAccountId, offlineReadOnly, fail, onInvitesLoaded }: TeamDirectoryOptions) {
  const [directory, setDirectory] = useState<DirectoryState>(emptyDirectory(null, "loading"));
  // The ONE fact the load effect needs about the directory it is replacing: which account (if any)
  // already has an AUTHORIZED members list on screen, so a later 403 for that same account reads as
  // "your access changed" rather than silently hiding a section the caller was just using. Held in a
  // ref — a dependency on the directory itself would re-run the load on every list update.
  const authorizedAccountRef = useRef<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestGeneration = useRef(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    authorizedAccountRef.current =
      directory.members !== null && directory.gate !== "hidden" ? directory.accountId : null;
  }, [directory]);
  useEffect(() => {
    if (!enabled || !activeAccountId || offlineReadOnly) return;
    const generation = ++requestGeneration.current;
    let cancelled = false;
    const current = () => !cancelled && requestGeneration.current === generation;
    void loadDirectory({
      accountId: activeAccountId,
      hadAuthorizedDirectory: authorizedAccountRef.current === activeAccountId,
      current,
      setDirectory,
      fail,
      onInvitesLoaded,
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, activeAccountId, reloadKey, fail, offlineReadOnly, onInvitesLoaded]);

  return { directory, setDirectory, requestGeneration, reload };
}

/**
 * Re-read the invitations alone, authoritatively.
 *
 * For the writes that can only have changed the INVITE list (creating one, revoking one): the
 * members read is a separate authorization, and re-running it would re-ask "may I still see this
 * section?" for a write that cannot have answered that question differently. Guarded exactly as
 * the main effect's invitations leg is — a response is applied only while both this read and the
 * members load that authorized it are still the current ones, and only onto the account it was
 * asked for, so a switch or a full reload that overtakes it discards it instead of resurrecting a
 * previous company's invites.
 */
function useInviteReload(
  { enabled, activeAccountId, offlineReadOnly, fail, onInvitesLoaded }: TeamDirectoryOptions,
  requestGeneration: MutableRefObject<number>,
  setDirectory: SetDirectory,
) {
  const inviteGeneration = useRef(0);
  return useCallback(async (): Promise<void> => {
    if (!enabled || !activeAccountId || offlineReadOnly) return;
    const accountId = activeAccountId;
    const generation = ++inviteGeneration.current;
    const loadGeneration = requestGeneration.current;
    const current = () => inviteGeneration.current === generation && requestGeneration.current === loadGeneration;
    try {
      const invites = await loadInvitations(accountId, current, fail);
      if (invites === null) return;
      setDirectory((previous) => (previous.accountId === accountId ? { ...previous, invites } : previous));
      onInvitesLoaded?.(invites);
    } catch (error) {
      if (current()) fail(null, m.settings_err_server({ error: resolveErrorMessage(error) }));
    }
  }, [enabled, activeAccountId, offlineReadOnly, fail, onInvitesLoaded, requestGeneration, setDirectory]);
}

function useActionState() {
  const actionLock = useRef<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const beginAction = useCallback((key: string): boolean => {
    if (actionLock.current !== null) return false;
    actionLock.current = key;
    setBusyAction(key);
    return true;
  }, []);
  const endAction = useCallback(() => {
    actionLock.current = null;
    setBusyAction(null);
  }, []);
  return { busyAction, beginAction, endAction };
}

/** Owns authoritative directory reads, self-gating, reload generations and action exclusion. */
export function useTeamDirectory(options: TeamDirectoryOptions) {
  const { activeAccountId } = options;
  const { directory, setDirectory, requestGeneration, reload } = useDirectoryRead(options);
  const reloadInvites = useInviteReload(options, requestGeneration, setDirectory);
  const { busyAction, beginAction, endAction } = useActionState();
  const currentAccountLoaded = directory.accountId === activeAccountId;
  const replaceDirectory = useCallback(
    (next: TeamDirectory, invites: TeamInvitation[]) => {
      setDirectory((previous) => ({
        ...previous,
        members: next.members,
        signInTrackingEnabled: next.signInTrackingEnabled,
        invites,
      }));
    },
    [setDirectory],
  );

  return {
    members: currentAccountLoaded ? directory.members : null,
    invites: currentAccountLoaded ? directory.invites : NO_INVITES,
    signInTrackingEnabled: currentAccountLoaded ? directory.signInTrackingEnabled : false,
    gate: currentAccountLoaded ? directory.gate : "loading",
    replaceDirectory,
    reload,
    reloadInvites,
    busyAction,
    beginAction,
    endAction,
  };
}
