import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import { errorMessage } from "../../lib/errorMessage";
import {
  teamAccessClient,
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

/** Owns authoritative directory reads, self-gating, reload generations and action exclusion. */
export function useTeamDirectory({
  enabled,
  activeAccountId,
  offlineReadOnly,
  fail,
  onInvitesLoaded,
}: TeamDirectoryOptions) {
  const [directory, setDirectory] = useState<{
    accountId: string | null;
    members: TeamMember[] | null;
    invites: TeamInvitation[];
    signInTrackingEnabled: boolean;
    gate: "loading" | "shown" | "hidden" | "error";
  }>({ accountId: null, members: null, invites: [], signInTrackingEnabled: false, gate: "loading" });
  // The ONE fact the load effect needs about the directory it is replacing: which account (if any)
  // already has an AUTHORIZED members list on screen, so a later 403 for that same account reads as
  // "your access changed" rather than silently hiding a section the caller was just using. Held in a
  // ref — a dependency on the directory itself would re-run the load on every list update.
  const authorizedAccountRef = useRef<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestGeneration = useRef(0);
  const inviteGeneration = useRef(0);
  const actionLock = useRef<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
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

  useEffect(() => {
    authorizedAccountRef.current =
      directory.members !== null && directory.gate !== "hidden" ? directory.accountId : null;
  }, [directory]);

  useEffect(() => {
    if (!enabled || !activeAccountId || offlineReadOnly) return;
    const hadAuthorizedDirectory = authorizedAccountRef.current === activeAccountId;
    const generation = ++requestGeneration.current;
    let cancelled = false;
    const current = () => !cancelled && requestGeneration.current === generation;

    void (async () => {
      let membersLoaded = false;
      try {
        const membersResult = await teamAccessClient.listMembers(activeAccountId);
        if (membersResult.kind === "rejected" && membersResult.status === 403) {
          if (current()) {
            if (hadAuthorizedDirectory) {
              setDirectory((previous) => ({ ...previous, gate: "error" }));
              fail(null, m.settings_members_err_access_changed());
            } else {
              setDirectory({
                accountId: activeAccountId,
                members: null,
                invites: [],
                signInTrackingEnabled: false,
                gate: "hidden",
              });
            }
          }
          return;
        }
        if (membersResult.kind === "invalid") {
          throw new Error("The server returned an invalid members response.");
        }
        if (membersResult.kind !== "ok") {
          if (!current()) return;
          setDirectory({
            accountId: activeAccountId,
            members: null,
            invites: [],
            signInTrackingEnabled: false,
            gate: "error",
          });
          fail(
            null,
            membersResult.kind === "rejected" && membersResult.message
              ? membersResult.message
              : m.settings_members_err_load({ status: membersResult.status }),
          );
          return;
        }
        if (!current()) return;
        setDirectory((previous) => ({
          accountId: activeAccountId,
          members: membersResult.value.members,
          signInTrackingEnabled: membersResult.value.signInTrackingEnabled,
          // Preserve the last authoritative invitation list while a same-account refresh is in
          // flight. On an account switch, the old list is both hidden by the account key below and
          // discarded here before this account's separately-authorized invite read completes.
          invites: previous.accountId === activeAccountId ? previous.invites : [],
          gate: "shown",
        }));
        membersLoaded = true;

        const invitationsResult = await teamAccessClient.listInvitations(activeAccountId);
        if (invitationsResult.kind === "invalid") {
          throw new Error("The server returned an invalid invites response.");
        }
        if (invitationsResult.kind !== "ok") {
          if (!current()) return;
          fail(
            null,
            invitationsResult.kind === "rejected" && invitationsResult.message
              ? invitationsResult.message
              : m.settings_invites_err_load({ status: invitationsResult.status }),
          );
          return;
        }
        if (current()) {
          setDirectory((previous) =>
            previous.accountId === activeAccountId ? { ...previous, invites: invitationsResult.value } : previous,
          );
          onInvitesLoaded?.(invitationsResult.value);
        }
      } catch (error) {
        if (!current()) return;
        if (!membersLoaded) {
          setDirectory({
            accountId: activeAccountId,
            members: null,
            invites: [],
            signInTrackingEnabled: false,
            gate: "error",
          });
        }
        fail(null, m.settings_err_server({ error: errorMessage(error) }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, activeAccountId, reloadKey, fail, offlineReadOnly, onInvitesLoaded]);

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
  const reloadInvites = useCallback(async (): Promise<void> => {
    if (!enabled || !activeAccountId || offlineReadOnly) return;
    const accountId = activeAccountId;
    const generation = ++inviteGeneration.current;
    const loadGeneration = requestGeneration.current;
    const current = () => inviteGeneration.current === generation && requestGeneration.current === loadGeneration;
    try {
      const invitationsResult = await teamAccessClient.listInvitations(accountId);
      if (invitationsResult.kind === "invalid") {
        throw new Error("The server returned an invalid invites response.");
      }
      if (invitationsResult.kind !== "ok") {
        if (!current()) return;
        fail(
          null,
          invitationsResult.kind === "rejected" && invitationsResult.message
            ? invitationsResult.message
            : m.settings_invites_err_load({ status: invitationsResult.status }),
        );
        return;
      }
      if (!current()) return;
      setDirectory((previous) =>
        previous.accountId === accountId ? { ...previous, invites: invitationsResult.value } : previous,
      );
      onInvitesLoaded?.(invitationsResult.value);
    } catch (error) {
      if (!current()) return;
      fail(null, m.settings_err_server({ error: errorMessage(error) }));
    }
  }, [enabled, activeAccountId, offlineReadOnly, fail, onInvitesLoaded]);

  const currentAccountLoaded = directory.accountId === activeAccountId;

  const replaceDirectory = useCallback((next: TeamDirectory, invites: TeamInvitation[]) => {
    setDirectory((previous) => ({
      ...previous,
      members: next.members,
      signInTrackingEnabled: next.signInTrackingEnabled,
      invites,
    }));
  }, []);

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
