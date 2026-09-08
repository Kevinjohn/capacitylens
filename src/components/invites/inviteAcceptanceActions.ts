import type { Dispatch, SetStateAction, RefObject } from "react";
import type { InviteAcceptState } from "./InviteAcceptView";
import {
  accountClient,
  readUnknownAccountCommandOutcome,
  createBrowserAccountCommand,
  type BrowserAccountCommand,
} from "../../account/accountClient";
import { m } from "@/i18n";
import { readAccountFailure, resolveMessageForStatus } from "./inviteResponses";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { isAccountRole } from "@capacitylens/shared/account/types";
import type { Role } from "@capacitylens/shared/domain/access";
import { useStore } from "../../store/useStore";

interface Dependencies {
  token: string | undefined;
  previewed: RefObject<string | null>;
  accepting: RefObject<boolean>;
  acceptCommand: RefObject<BrowserAccountCommand | null>;
  routeActive: RefObject<boolean>;
  setState: Dispatch<SetStateAction<InviteAcceptState>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

type InviteStateSetter = Dependencies["setState"];

interface AcceptedMembership {
  accountId: string;
  role: Role;
}

async function readAcceptedMembership(response: Response): Promise<AcceptedMembership | null> {
  const body: unknown = await response.json().catch(() => ({}));
  if (typeof body !== "object" || body === null) return null;
  if (!("accountId" in body) || typeof body.accountId !== "string" || body.accountId.length === 0) return null;
  if (!("role" in body) || !isAccountRole(body.role)) return null;
  return { accountId: body.accountId, role: body.role };
}

async function refreshInvalidResult(setState: InviteStateSetter): Promise<void> {
  const list = await refreshAccountSummaries({ allowCachedFallback: false });
  const message = list !== null ? m.invite_invalid_result_refreshed() : m.invite_invalid_result_refresh_failed();
  setState({ kind: "error", message });
}

async function resolveRejectedMessage(
  response: Response,
  outcomeUnknown: boolean,
  failure: Awaited<ReturnType<typeof readAccountFailure>>,
): Promise<string> {
  let reconciliation = "";
  if (outcomeUnknown) {
    const list = await refreshAccountSummaries({ allowCachedFallback: false });
    reconciliation = list !== null ? m.invite_unknown_refreshed() : m.invite_unknown_refresh_failed();
  }
  if (failure.code === "INVITATION_EMAIL_MISMATCH") return m.invite_err_identity_mismatch();
  if (!outcomeUnknown) return resolveMessageForStatus(response.status, failure.message ?? undefined);
  return `${failure.message ?? m.invite_unknown_pending()} ${reconciliation}`;
}

async function handleRejectedAcceptance(
  response: Response,
  acceptCommand: Dependencies["acceptCommand"],
  setState: InviteStateSetter,
): Promise<void> {
  const outcomeUnknown = await readUnknownAccountCommandOutcome(response);
  const failure = await readAccountFailure(response);
  if (response.status >= 400 && response.status < 500 && !outcomeUnknown) {
    acceptCommand.current = createBrowserAccountCommand();
  }
  if (response.status === 401) {
    setState({ kind: "auth", message: resolveMessageForStatus(401, failure.message ?? undefined) });
    return;
  }
  const message = await resolveRejectedMessage(response, outcomeUnknown, failure);
  setState({
    kind: "error",
    message,
    retryAccept: outcomeUnknown,
    switchIdentity: failure.code === "INVITATION_EMAIL_MISMATCH",
  });
}

async function activateJoinedAccount(
  membership: AcceptedMembership,
  routeActive: Dependencies["routeActive"],
  setState: InviteStateSetter,
): Promise<void> {
  try {
    const list = await refreshAccountSummaries({
      signal: AbortSignal.timeout(5000),
      allowCachedFallback: false,
      preserveActiveAccountIfMissing: true,
    });
    // The directory refresh remains useful after navigation, but this route no longer owns the
    // global company selection once it has unmounted. A company chosen on the destination route
    // must not be replaced by this late invitation completion.
    if (routeActive.current && list !== null) {
      // This pre-session route deliberately has no persistence owner attached. Seed only the
      // verified handoff id; the fresh authenticated boot owns its hydration.
      if (list.some((account) => account.id === membership.accountId)) {
        useStore.getState().setActiveAccount(membership.accountId);
      }
    }
  } catch (error) {
    // The 2xx accept response already confirmed durable membership. Activation is a separate,
    // best-effort read: never relabel a confirmed join as an unknown mutation or invite retry.
    console.warn("InviteAccept: joined-company activation refresh failed", error);
  } finally {
    if (routeActive.current) {
      setState((current) => (current.kind === "joined" ? { ...current, activating: false } : current));
    }
  }
}

async function reportUnknownAcceptance(setState: InviteStateSetter, error: unknown): Promise<void> {
  // The POST may have reached the server before the transport failed, so do not invite a blind
  // retry. Refresh authoritative membership state and explain how to verify the outcome.
  console.error("InviteAccept: accept request failed", error);
  const list = await refreshAccountSummaries({ allowCachedFallback: false });
  const message = list !== null ? m.invite_unknown_outcome_refreshed() : m.invite_unknown_outcome_refresh_failed();
  setState({ kind: "error", message, retryAccept: true });
}

export function createInviteAcceptanceActions({
  token,
  previewed,
  accepting,
  acceptCommand,
  routeActive,
  setState,
  setBusy,
}: Dependencies) {
  const acceptInvite = async (): Promise<void> => {
    if (!token || previewed.current !== token || accepting.current) return;
    accepting.current = true;
    setBusy(true);
    setState({ kind: "accepting" });
    try {
      const command = acceptCommand.current ?? (acceptCommand.current = createBrowserAccountCommand());
      const response = await accountClient.acceptInvitation(token, command);
      if (!response.ok) {
        await handleRejectedAcceptance(response, acceptCommand, setState);
        return;
      }

      const membership = await readAcceptedMembership(response);
      if (!membership) {
        await refreshInvalidResult(setState);
        return;
      }

      // Use the role returned by the mutation, not the proposed role in the preview: the server may
      // have resolved an existing membership with a different effective role.
      setState({ kind: "joined", ...membership, activating: true });
      await activateJoinedAccount(membership, routeActive, setState);
    } catch (error) {
      await reportUnknownAcceptance(setState, error);
    } finally {
      accepting.current = false;
      setBusy(false);
    }
  };

  return { acceptInvite };
}
