import type { Dispatch, SetStateAction } from "react";
import type { InviteAcceptState } from "./InviteAcceptView";
import { m } from "@/i18n";
import type { AuthProviderInfo } from "../../auth/authContext";
import { startMicrosoftConnection } from "../../auth/microsoftConnectionClient";
import { authClient } from "../../auth/authClient";
import { reloadPage } from "../../lib/reloadPage";
import { buildExternalSignInErrorUrl } from "../../auth/externalSignInError";
import { runExternalSignIn } from "./externalSignIn";
import type { FormEvent } from "react";

interface Dependencies {
  token: string | undefined;
  email: string;
  password: string;
  setState: Dispatch<SetStateAction<InviteAcceptState>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
}

function startProviderSignIn(provider: AuthProviderInfo, token: string | undefined, signal: AbortSignal) {
  if (provider.id === "microsoft") {
    if (!token) throw new Error("The invitation link is missing.");
    return startMicrosoftConnection(
      {
        purpose: "invite",
        inviteToken: token,
        callbackURL: window.location.href,
        errorCallbackURL: buildExternalSignInErrorUrl(window.location.href),
      },
      signal,
    );
  }
  const options = {
    callbackURL: window.location.href,
    errorCallbackURL: buildExternalSignInErrorUrl(window.location.href),
    disableRedirect: true,
    fetchOptions: { signal },
  };
  return authClient.signIn.social({ ...options, provider: provider.id });
}

export function createInviteSignInActions({ token, email, password, setState, setBusy }: Dependencies) {
  const signInAndReload = async (): Promise<void> => {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message ?? m.login_failed());
    reloadPage();
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setState({ kind: "auth" });
    try {
      await signInAndReload();
    } catch (error) {
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
      // Keep redirect ownership in runExternalSignIn so Better Auth and the Microsoft start
      // endpoint share the same abort-before-retry and navigation lifecycle.
      start: (signal) => startProviderSignIn(provider, token, signal),
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

  return { signIn, signInWithProvider };
}
