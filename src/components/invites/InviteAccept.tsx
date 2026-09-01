import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { isServerConfigured } from "../../data/apiConfig";
import {
  accountClient,
  accountCommandOutcomeUnknown,
  newBrowserAccountCommand,
  type BrowserAccountCommand,
} from "../../account/accountClient";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { readApiError } from "../../lib/readApiError";
import { authClient } from "../../auth/authClient";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m } from "@/i18n";
import { runExternalSignIn } from "./externalSignIn";
import { validateText } from "../../lib/validation";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, passwordLengthFailure } from "@capacitylens/shared/domain/password";
import { isAccountRole, isIsoInstant } from "@capacitylens/shared/account/types";
import { isTransportFailure } from "../../data/requestTimeout";
import { useAuth } from "../../auth/authContext";
import {
  clearExternalSignInError,
  externalSignInErrorUrl,
  hasExternalSignInError,
} from "../../auth/externalSignInError";
import { replaceWithAccountPicker, replaceWithJoinedAccount } from "../../lib/joinedAccountHandoff";
import { reloadPage } from "../../lib/reloadPage";
import { InviteAcceptView, type InviteAcceptState, type InvitePreview } from "./InviteAcceptView";
import { transitionAccount } from "../../auth/accountTransition";

// Invite accept page for /invite/:token. On mount, in SERVER mode, it previews the invite.
// A signed-in person must then explicitly accept before the single-use POST is sent. The server is
// the authority: a valid link binds the invited role to the signed-in caller's membership; a
// used/expired/unknown link is refused. This page never re-implements that policy client-side.
//
// PRE-SESSION ONBOARDING: this route sits inside AuthProvider but outside AppShell's tenant gate.
// Password mode deliberately carves it out of the login wall so a genuinely new invitee can create
// a credential through the token-scoped signup endpoint; an existing user can sign in here and the
// page reloads the same token URL so they can review and explicitly accept as that identity.

// Map the accept endpoint's status codes to the surfaced message. 404/409/410 are the documented
// invite outcomes (unknown / already-used / expired); the server's JSON `{ error }` body carries a
// friendly sentence we prefer, with a safe fallback per status when the body is missing/unreadable.
function messageForStatus(status: number, bodyError: string | undefined): string {
  if (bodyError) return bodyError;
  if (status === 404) return m.invite_err_not_found();
  if (status === 409) return m.invite_err_used();
  if (status === 410) return m.invite_err_expired();
  if (status === 401) return m.invite_err_signin();
  return m.invite_err_generic();
}
function parsePreview(value: unknown): InvitePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.accountName !== "string" || row.accountName.trim().length === 0) return null;
  if (!isAccountRole(row.role) || row.role === "owner") return null;
  if (!isIsoInstant(row.expiresAt)) return null;
  return {
    accountName: row.accountName,
    role: row.role,
    expiresAt: row.expiresAt,
  };
}

async function accountFailure(response: Response): Promise<{ code: string | null; message: string | null }> {
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return { code: null, message: null };
  const failure = body as { code?: unknown; error?: unknown };
  return {
    code: typeof failure.code === "string" ? failure.code : null,
    message: typeof failure.error === "string" && failure.error.length > 0 ? failure.error : null,
  };
}

/**
 * Invite-accept page for `/invite/:token`.
 *
 * In server mode it previews the invite, asks a signed-in person to accept explicitly, then renders
 * a "you've joined" success (with a continue link after switching to the joined company), the
 * matching endpoint error, or a generic failure. In the demo build there is no server to accept
 * against, so it shows a short "invites require server mode" note and makes no request.
 */
export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  // React Router may preserve the route element while only changing `:token`. Key the stateful
  // implementation so preview data and command identities can never cross invitation URLs.
  return <InviteAcceptForToken key={token ?? ""} token={token} />;
}

function InviteAcceptForToken({ token }: { token: string | undefined }) {
  const { authMode, user, providers: configuredProviders, refreshAuth, signOut } = useAuth();
  const providers = configuredProviders ?? [];
  const [returnedWithExternalError] = useState(() => hasExternalSignInError(window.location.href));
  // The initial render already encodes the no-fetch outcomes (the demo build; a missing token — which the
  // `/invite/:token` route shouldn't even match, but is handled defensively), so the effect never has
  // to setState synchronously: it only ever sets state from an async fetch callback.
  const [state, setState] = useState<InviteAcceptState>(() => {
    if (!isServerConfigured()) return { kind: "local" };
    if (!token) return { kind: "error", message: m.invite_err_missing_token() };
    return { kind: "previewing" };
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  // Records a successfully parsed preview, not an in-flight attempt. React StrictMode cancels and
  // restarts effects in development; marking the first attempt as complete before it resolves would
  // suppress the replacement request and strand the page on “Checking invite…”.
  const previewed = useRef<string | null>(null);
  const currentUser = useRef(user);
  const routeActive = useRef(false);
  const accepting = useRef(false);
  const acceptCommand = useRef<BrowserAccountCommand | null>(null);
  const signupCommand = useRef<BrowserAccountCommand | null>(null);
  const flowStatusRef = useRef<HTMLParagraphElement | null>(null);
  const continueRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    currentUser.current = user;
  }, [user]);

  useEffect(() => {
    if (state.kind === "accepting") flowStatusRef.current?.focus();
    if (state.kind === "joined" && !state.activating) continueRef.current?.focus();
  }, [state]);

  useEffect(() => {
    routeActive.current = true;
    return () => {
      routeActive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!returnedWithExternalError) return;
    window.history.replaceState(window.history.state, "", clearExternalSignInError(window.location.href));
  }, [returnedWithExternalError]);

  // Preserve the command across a true retry with unchanged credential input. Once the person
  // edits the semantic payload, a new idempotency identity is required or the server must correctly
  // reject it as a conflicting reuse of the prior command.
  useEffect(() => {
    signupCommand.current = newBrowserAccountCommand();
  }, [token, name, email, password]);

  // Per-route document.title (WCAG 2.4.2). This route renders OUTSIDE AppShell (see router.tsx), so
  // it isn't covered by the shell's nav-driven title effect — set it here from the same `invite_title`
  // message the heading uses ("Accept invite"), so the tab/history/bookmark reads descriptively rather
  // than index.html's static brand. `APP_NAME` keeps the brand single-sourced (see shared/brand).
  useEffect(() => {
    document.title = `${m.invite_title()} · ${APP_NAME}`;
  }, []);

  useEffect(() => {
    if (!isServerConfigured() || !token) return; // demo build / no token: nothing to preview
    let cancelled = false;

    void (async () => {
      try {
        const previewResponse = await accountClient.previewInvitation(token);
        if (cancelled) return;
        if (!previewResponse.ok) {
          setState({
            kind: "error",
            message: messageForStatus(previewResponse.status, await readApiError(previewResponse)),
          });
          return;
        }
        const parsedPreview = parsePreview(await previewResponse.json().catch(() => null));
        if (cancelled) return;
        if (!parsedPreview) {
          setState({ kind: "error", message: m.invite_err_preview_invalid() });
          return;
        }
        previewed.current = token;
        setPreview(parsedPreview);
        setState(
          currentUser.current
            ? { kind: "ready" }
            : {
                kind: "auth",
                ...(returnedWithExternalError ? { message: m.login_sso_failed() } : {}),
              },
        );
      } catch (err) {
        if (cancelled) return;
        // Preview is read-only, so a transport failure cannot have consumed the invite. Keep this
        // distinct from an accept failure, whose outcome may genuinely be unknown.
        console.error("InviteAccept: preview request failed", err);
        setState({
          kind: "error",
          message: m.invite_err_network(),
          retryPreview: true,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewAttempt, returnedWithExternalError, token]);

  const acceptInvite = async (): Promise<void> => {
    if (!token || previewed.current !== token || accepting.current) return;
    accepting.current = true;
    setBusy(true);
    setState({ kind: "accepting" });
    try {
      const command = acceptCommand.current ?? (acceptCommand.current = newBrowserAccountCommand());
      const res = await accountClient.acceptInvitation(token, command);
      if (!res.ok) {
        const outcomeUnknown = await accountCommandOutcomeUnknown(res);
        const failure = await accountFailure(res);
        if (res.status >= 400 && res.status < 500 && !outcomeUnknown) {
          acceptCommand.current = newBrowserAccountCommand();
        }
        if (res.status === 401) {
          setState({
            kind: "auth",
            message: messageForStatus(401, failure.message ?? undefined),
          });
        } else {
          let reconciliation = "";
          if (outcomeUnknown) {
            const list = await refreshAccountSummaries({
              allowCachedFallback: false,
            });
            reconciliation = list !== null ? m.invite_unknown_refreshed() : m.invite_unknown_refresh_failed();
          }
          setState({
            kind: "error",
            message:
              failure.code === "INVITATION_EMAIL_MISMATCH"
                ? m.invite_err_identity_mismatch()
                : outcomeUnknown
                  ? `${failure.message ?? m.invite_unknown_pending()} ${reconciliation}`
                  : messageForStatus(res.status, failure.message ?? undefined),
            retryAccept: outcomeUnknown,
            switchIdentity: failure.code === "INVITATION_EMAIL_MISMATCH",
          });
        }
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        accountId?: string;
        role?: string;
      };
      const accountId = typeof body.accountId === "string" && body.accountId.length > 0 ? body.accountId : "";
      if (!accountId || !isAccountRole(body.role)) {
        const list = await refreshAccountSummaries({
          allowCachedFallback: false,
        });
        setState({
          kind: "error",
          message: list !== null ? m.invite_invalid_result_refreshed() : m.invite_invalid_result_refresh_failed(),
        });
        return;
      }

      // Use the role returned by the mutation, not the proposed role in the preview: the server may
      // have resolved an existing membership with a different effective role.
      setState({ kind: "joined", accountId, role: body.role, activating: true });
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
          if (list.some((account) => account.id === accountId)) void transitionAccount(accountId);
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
    } catch (error) {
      // The POST may have reached the server before the transport failed, so do not invite a blind
      // retry. Refresh authoritative membership state and explain how to verify the outcome.
      console.error("InviteAccept: accept request failed", error);
      const list = await refreshAccountSummaries({ allowCachedFallback: false });
      setState({
        kind: "error",
        message: list !== null ? m.invite_unknown_outcome_refreshed() : m.invite_unknown_outcome_refresh_failed(),
        retryAccept: true,
      });
    } finally {
      accepting.current = false;
      setBusy(false);
    }
  };

  const signInAndReload = async (): Promise<void> => {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message ?? m.login_failed());
    reloadPage();
  };

  /** Recheck the new cookie and authoritative companies before entering AppShell. The invite page
   * booted without a session, so its initial persistence bootstrap is deliberately unattached after
   * the 401. A fresh boot is required for safe saving; its one-use query value is verified against
   * `/api/accounts` by AppShell before activation and then removed from the URL. */
  const enterJoinedCompany = async (accountId?: string): Promise<void> => {
    await refreshAuth();
    const list = await refreshAccountSummaries({
      signal: AbortSignal.timeout(5000),
      allowCachedFallback: false,
    });
    if (list !== null) {
      const target = accountId
        ? list.find((account) => account.id === accountId)
        : list.length === 1
          ? list[0]
          : undefined;
      if (target) {
        await transitionAccount(target.id);
        replaceWithJoinedAccount(target.id);
        return;
      }
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
      setState({
        kind: "auth",
        message: error instanceof Error ? error.message : m.login_failed(),
      });
      setBusy(false);
    }
  };

  const signInWithProvider = async (provider: (typeof providers)[number]): Promise<void> => {
    setBusy(true);
    setState({ kind: "auth" });
    await runExternalSignIn({
      start: (signal) =>
        provider.kind === "oidc"
          ? authClient.signIn.oauth2({
              providerId: provider.id,
              callbackURL: window.location.href,
              errorCallbackURL: externalSignInErrorUrl(window.location.href),
              // Keep redirect ownership in runExternalSignIn: Better Auth returns the provider URL
              // without running its internal navigation hook, and a timed-out request is aborted
              // before retry controls become available.
              disableRedirect: true,
              fetchOptions: { signal },
            })
          : authClient.signIn.social({
              provider: provider.id as "google" | "microsoft" | "github",
              callbackURL: window.location.href,
              errorCallbackURL: externalSignInErrorUrl(window.location.href),
              disableRedirect: true,
              fetchOptions: { signal },
            }),
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

  const createAccount = async () => {
    if (!token || previewed.current !== token) return;
    const report = (errorField: string | null, message: string) => {
      setState({ kind: "auth", message, errorField });
    };
    const cleanName = validateText(name, report, {
      field: "name",
      requiredMessage: m.identity_err_name(),
    });
    if (cleanName === null) return;
    const cleanEmail = normalizeAccountEmail(email);
    if (!isAccountEmail(cleanEmail)) {
      report("email", m.identity_err_email());
      return;
    }
    if (passwordLengthFailure(password)) {
      report(
        "password",
        m.identity_err_password({
          min: MIN_PASSWORD_LENGTH,
          max: MAX_PASSWORD_LENGTH,
        }),
      );
      return;
    }
    setBusy(true);
    setState({ kind: "auth" });
    let commandOutcomeUnknown = false;
    try {
      const command = signupCommand.current ?? (signupCommand.current = newBrowserAccountCommand());
      const res = await accountClient.signupWithInvitation(
        token,
        {
          name: cleanName,
          email: cleanEmail,
          password,
        },
        command,
      );
      if (!res.ok) {
        commandOutcomeUnknown = await accountCommandOutcomeUnknown(res);
        const failure = await accountFailure(res);
        if (res.status >= 400 && res.status < 500 && !commandOutcomeUnknown) {
          signupCommand.current = newBrowserAccountCommand();
        }
        throw new Error(failure.message ?? messageForStatus(res.status, undefined));
      }
      const signupBody = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const accountId =
        typeof signupBody?.accountId === "string" && signupBody.accountId.length > 0 ? signupBody.accountId : null;
      if (!accountId || !isAccountRole(signupBody?.role)) {
        throw new Error(m.invite_signup_invalid_result());
      }
      const { error } = await authClient.signIn.email({
        email: cleanEmail,
        password,
      });
      if (error) throw new Error(error.message ?? m.login_failed());
      // Signup already claimed the invite atomically. Verify the exact company, then start a fresh
      // authenticated boot with persistence attached and a one-use activation handoff.
      await enterJoinedCompany(accountId);
    } catch (error) {
      const unknownFailure = isTransportFailure(error) || commandOutcomeUnknown;
      if (unknownFailure) {
        try {
          const signInResult = await authClient.signIn.email({
            email: cleanEmail,
            password,
          });
          if (!signInResult.error) {
            // Do not guess from the caller's company count: the signup request may never have reached
            // the server and these credentials may belong to an existing identity. Reload the same
            // bearer URL; an unused invite can then be accepted explicitly, while a consumed invite
            // truthfully reports that state and lets the caller inspect their authenticated picker.
            reloadPage();
            return;
          }
        } catch (signInError) {
          // The recovery probe is best-effort and may fail for the same network reason as signup.
          // Keep the original unknown-outcome guidance and restore the form instead of leaking a
          // rejected event-handler promise that leaves the page permanently busy.
          console.warn("InviteAccept: signup recovery sign-in failed", signInError);
        }
      }
      setState({
        kind: "auth",
        message: unknownFailure
          ? m.invite_signup_unknown()
          : error instanceof Error
            ? error.message
            : m.invite_err_generic(),
      });
      setBusy(false);
    }
  };

  return (
    <InviteAcceptView
      state={state}
      preview={preview}
      user={user}
      authMode={authMode}
      providers={providers}
      busy={busy}
      errorId={errorId}
      name={name}
      email={email}
      password={password}
      flowStatusRef={flowStatusRef}
      continueRef={continueRef}
      onNameChange={setName}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onAccept={() => void acceptInvite()}
      onSignOut={() => void signOut()}
      onSignIn={(event) => void signIn(event)}
      onProviderSignIn={(provider) => void signInWithProvider(provider)}
      onCreateAccount={() => void createAccount()}
      onRetryPreview={() => {
        setState({ kind: "previewing" });
        setPreviewAttempt((attempt) => attempt + 1);
      }}
    />
  );
}
