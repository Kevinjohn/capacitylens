import type { Dispatch, SetStateAction } from "react";
import type { InviteAcceptState } from "./InviteAcceptView";
import { m } from "@/i18n";
import { MAX_PASSWORD_INPUT_CODE_UNITS } from "@capacitylens/shared/domain/password";
import type { AuthProviderInfo } from "@/auth/authContext";
import { authClient } from "@/auth/authClient";
import { reloadPage } from "@/lib/reloadPage";
import { refreshAccountSummaries } from "@/auth/useAccountSummaries";
import { useStore } from "@/store/useStore";
import { replaceWithAccountPicker, replaceWithJoinedAccount } from "@/lib/joinedAccountHandoff";
import { buildExternalSignInErrorUrl } from "@/auth/externalSignInError";
import { runExternalSignIn } from "./externalSignIn";
import type { FormEvent } from "react";

interface Dependencies {
  email: string;
  password: string;
  refreshAuth: () => Promise<void>;
  setState: Dispatch<SetStateAction<InviteAcceptState>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

function resolveJoinedAccount(list: Awaited<ReturnType<typeof refreshAccountSummaries>>, accountId?: string) {
  if (list === null) return undefined;
  if (accountId) return list.find((account) => account.id === accountId);
  if (list.length === 1) return list[0];
  return undefined;
}

function startProviderSignIn(provider: AuthProviderInfo, signal: AbortSignal) {
  const options = {
    callbackURL: window.location.href,
    errorCallbackURL: buildExternalSignInErrorUrl(window.location.href),
    fetchOptions: { signal },
  };
  return authClient.signIn.social({ ...options, provider: provider.id });
}

/** Builds sign-in actions that resume the pending invitation. */
export function createInviteSignInActions({ email, password, refreshAuth, setState, setBusy }: Dependencies) {
  const signInAndReload = async (): Promise<void> => {
    if (password.length > MAX_PASSWORD_INPUT_CODE_UNITS) throw new Error(m.login_password_input_too_long());
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message);
    reloadPage();
  };

  // Recheck the authenticated directory before activation, then boot persistence for the verified company. A pre-session invite page has no persistence owner to resume.
  const enterJoinedCompany = async (accountId?: string): Promise<void> => {
    await refreshAuth();
    const list = await refreshAccountSummaries({
      signal: AbortSignal.timeout(5000),
      allowCachedFallback: false,
    });
    const target = resolveJoinedAccount(list, accountId);
    if (target) {
      // This route precedes the authenticated persistence lifecycle. The destination boot
      // re-verifies and hydrates the selected company from this already-authoritative directory.
      useStore.getState().setActiveAccount(target.id);
      replaceWithJoinedAccount(target.id);
      return;
    }
    // A failed authoritative list read cannot safely activate a caller-supplied id. Reboot into the
    // ordinary authenticated picker, which retries the list without trusting the invite response.
    replaceWithAccountPicker();
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setState({ kind: "auth" });
    try {
      await signInAndReload();
    } catch (error) {
      // Surface a failed authenticated-entry transition and release the invite sign-in controls.
      setState({
        kind: "auth",
        message: error instanceof Error ? error.message : m.login_failed(),
      });
      setBusy(false);
    }
  };

  const signInWithProvider = async (provider: AuthProviderInfo): Promise<void> => {
    setBusy(true);
    setState({ kind: "auth" });
    await runExternalSignIn({
      // Keep redirect ownership in runExternalSignIn so provider start shares the same
      // abort-before-retry and navigation lifecycle as the password invitation flow.
      start: (signal) => startProviderSignIn(provider, signal),
      onFailure: (message) => {
        setState({ kind: "auth", message: message ?? m.login_failed() });
        setBusy(false);
      },
      onRequestError: (error) => {
        console.error("InviteAccept: SSO sign-in request failed", error);
        setState({ kind: "auth", message: m.login_network_error() });
        setBusy(false);
      },
      onCachedReturn: () => {
        setState({ kind: "auth", message: m.login_failed() });
        setBusy(false);
      },
    });
  };

  return { signIn, signInWithProvider, enterJoinedCompany };
}
