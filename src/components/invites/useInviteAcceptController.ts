import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { isServerConfigured } from "../../data/apiConfig";
import { newBrowserAccountCommand, type BrowserAccountCommand } from "../../account/accountClient";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m } from "@/i18n";
import { useAuth, type AuthProviderInfo } from "../../auth/authContext";
import { clearExternalSignInError, hasExternalSignInError } from "../../auth/externalSignInError";
import type { InviteAcceptState, InvitePreview } from "./InviteAcceptView";
import { createInvitePreviewAction } from "./invitePreviewActions";
import { createInviteAcceptanceActions } from "./inviteAcceptanceActions";
import { createInviteSignInActions } from "./inviteSignInActions";
import { createInviteSignupActions } from "./inviteSignupActions";

// One owner for the invite flow, shared credentials, live refs and idempotency tokens.
export function useInviteAcceptController(token: string | undefined) {
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
    return createInvitePreviewAction({
      token,
      previewed,
      currentUser,
      returnedWithExternalError,
      setPreview,
      setState,
    })();
  }, [previewAttempt, returnedWithExternalError, token]);

  const acceptInvite = async (): Promise<void> => {
    await createInviteAcceptanceActions({
      token,
      previewed,
      accepting,
      acceptCommand,
      routeActive,
      setState,
      setBusy,
    }).acceptInvite();
  };
  const { signIn, signInWithProvider, enterJoinedCompany } = createInviteSignInActions({
    email,
    password,
    refreshAuth,
    setState,
    setBusy,
  });
  const createAccount = async () => {
    await createInviteSignupActions({
      token,
      previewed,
      name,
      email,
      password,
      signupCommand,
      enterJoinedCompany,
      setState,
      setBusy,
    }).createAccount();
  };
  const flowStatusCallback = useCallback((node: HTMLParagraphElement | null) => {
    flowStatusRef.current = node;
  }, []);
  const continueCallback = useCallback((node: HTMLAnchorElement | null) => {
    continueRef.current = node;
  }, []);

  return {
    state,
    preview,
    user,
    authMode,
    providers,
    busy,
    errorId,
    name,
    email,
    password,
    flowStatusRef: flowStatusCallback,
    continueRef: continueCallback,
    onNameChange: setName,
    onEmailChange: setEmail,
    onPasswordChange: setPassword,
    onAccept: () => void acceptInvite(),
    onSignOut: () => void signOut(),
    onSignIn: (event: FormEvent) => void signIn(event),
    onProviderSignIn: (provider: AuthProviderInfo) => void signInWithProvider(provider),
    onCreateAccount: () => void createAccount(),
    onRetryPreview: () => {
      setState({ kind: "previewing" });
      setPreviewAttempt((attempt) => attempt + 1);
    },
  };
}
