import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { isServerConfigured } from "../../data/apiConfig";
import { createBrowserAccountCommand, type BrowserAccountCommand } from "../../account/accountClient";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m } from "@/i18n";
import { useAuth, type AuthProviderInfo } from "../../auth/authContext";
import { clearExternalSignInError, hasExternalSignInError } from "../../auth/externalSignInError";
import type { InviteAcceptState, InvitePreview } from "./InviteAcceptView";
import { createInvitePreviewAction } from "./invitePreviewActions";
import { createInviteAcceptanceActions } from "./inviteAcceptanceActions";
import { createInviteSignInActions } from "./inviteSignInActions";
import { createInviteSignupActions } from "./inviteSignupActions";

function useCurrentUserRef(user: ReturnType<typeof useAuth>["user"]) {
  const currentUser = useRef(user);
  useEffect(() => {
    currentUser.current = user;
  }, [user]);
  return currentUser;
}

function useInviteFocus(state: InviteAcceptState) {
  const flowStatusRef = useRef<HTMLParagraphElement | null>(null);
  const continueRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (state.kind === "accepting") flowStatusRef.current?.focus();
    if (state.kind === "joined" && !state.activating) continueRef.current?.focus();
  }, [state]);
  return { flowStatusRef, continueRef };
}

function useRouteActiveRef() {
  const routeActive = useRef(false);
  useEffect(() => {
    routeActive.current = true;
    return () => {
      routeActive.current = false;
    };
  }, []);
  return routeActive;
}

function useInviteRefs(user: ReturnType<typeof useAuth>["user"], state: InviteAcceptState) {
  const previewed = useRef<string | null>(null);
  const currentUser = useCurrentUserRef(user);
  const focusRefs = useInviteFocus(state);
  const routeActive = useRouteActiveRef();
  return {
    previewed,
    currentUser,
    routeActive,
    accepting: useRef(false),
    signupInFlight: useRef(false),
    acceptCommand: useRef<BrowserAccountCommand | null>(null),
    ...focusRefs,
  };
}

function useExternalErrorCleanup(returnedWithExternalError: boolean) {
  useEffect(() => {
    if (!returnedWithExternalError) return;
    window.history.replaceState(window.history.state, "", clearExternalSignInError(window.location.href));
  }, [returnedWithExternalError]);
}

function useDocumentTitle() {
  useEffect(() => {
    document.title = `${m.invite_title()} · ${APP_NAME}`;
  }, []);
}

// The initial render encodes the no-fetch outcomes, so preview fetching never sets state synchronously.
function useInviteState(token: string | undefined) {
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
  return {
    state,
    setState,
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    preview,
    setPreview,
    previewAttempt,
    setPreviewAttempt,
    busy,
    setBusy,
  };
}

// Preserve the command across a true retry, but replace its idempotency identity after payload edits.
function useSignupCommand({
  token,
  name,
  email,
  password,
}: Pick<InviteActionOptions, "token" | "name" | "email" | "password">) {
  const signupCommand = useRef<BrowserAccountCommand | null>(null);
  useEffect(() => {
    signupCommand.current = createBrowserAccountCommand();
  }, [token, name, email, password]);
  return signupCommand;
}

function useInvitePreview(options: Parameters<typeof createInvitePreviewAction>[0], previewAttempt: number) {
  const { token, previewed, currentUser, returnedWithExternalError, setPreview, setState } = options;
  useEffect(
    () =>
      createInvitePreviewAction({ token, previewed, currentUser, returnedWithExternalError, setPreview, setState })(),
    [currentUser, previewAttempt, previewed, returnedWithExternalError, setPreview, setState, token],
  );
}

function useFocusCallbacks({ flowStatusRef, continueRef }: ReturnType<typeof useInviteFocus>) {
  const flowStatusCallback = useCallback(
    (node: HTMLParagraphElement | null) => {
      flowStatusRef.current = node;
    },
    [flowStatusRef],
  );
  const continueCallback = useCallback(
    (node: HTMLAnchorElement | null) => {
      continueRef.current = node;
    },
    [continueRef],
  );
  return { flowStatusCallback, continueCallback };
}

interface InviteActionOptions {
  token: string | undefined;
  previewed: RefObject<string | null>;
  accepting: RefObject<boolean>;
  acceptCommand: RefObject<BrowserAccountCommand | null>;
  routeActive: ReturnType<typeof useRouteActiveRef>;
  signupCommand: RefObject<BrowserAccountCommand | null>;
  signupInFlight: RefObject<boolean>;
  name: string;
  email: string;
  password: string;
  refreshAuth: ReturnType<typeof useAuth>["refreshAuth"];
  setState: ReturnType<typeof useInviteState>["setState"];
  setBusy: ReturnType<typeof useInviteState>["setBusy"];
}

function createInviteControllerActions(options: InviteActionOptions) {
  const { signIn, signInWithProvider, enterJoinedCompany } = createInviteSignInActions(options);
  const acceptInvite = async (): Promise<void> => {
    await createInviteAcceptanceActions(options).acceptInvite();
  };
  const createAccount = async () => {
    await createInviteSignupActions({ ...options, enterJoinedCompany }).createAccount();
  };
  return { acceptInvite, signIn, signInWithProvider, createAccount };
}

function useInviteFlow(
  token: string | undefined,
  user: ReturnType<typeof useAuth>["user"],
  refreshAuth: ReturnType<typeof useAuth>["refreshAuth"],
) {
  const [returnedWithExternalError] = useState(() => hasExternalSignInError(window.location.href));
  const inviteState = useInviteState(token);
  const errorId = useId();
  // Records a successfully parsed preview, not an in-flight attempt. React StrictMode cancels and
  // restarts effects in development; marking the first attempt as complete before it resolves would
  // suppress the replacement request and strand the page on “Checking invite…”.
  const refs = useInviteRefs(user, inviteState.state);
  useExternalErrorCleanup(returnedWithExternalError);
  const signupCommand = useSignupCommand({ token, ...inviteState });

  useDocumentTitle();

  useInvitePreview(
    {
      token,
      previewed: refs.previewed,
      currentUser: refs.currentUser,
      returnedWithExternalError,
      setPreview: inviteState.setPreview,
      setState: inviteState.setState,
    },
    inviteState.previewAttempt,
  );

  const { acceptInvite, signIn, signInWithProvider, createAccount } = createInviteControllerActions({
    token,
    previewed: refs.previewed,
    accepting: refs.accepting,
    acceptCommand: refs.acceptCommand,
    routeActive: refs.routeActive,
    signupCommand,
    signupInFlight: refs.signupInFlight,
    name: inviteState.name,
    email: inviteState.email,
    password: inviteState.password,
    refreshAuth,
    setState: inviteState.setState,
    setBusy: inviteState.setBusy,
  });
  const { flowStatusCallback, continueCallback } = useFocusCallbacks(refs);

  return {
    state: inviteState.state,
    preview: inviteState.preview,
    busy: inviteState.busy,
    errorId,
    name: inviteState.name,
    email: inviteState.email,
    password: inviteState.password,
    flowStatusRef: flowStatusCallback,
    continueRef: continueCallback,
    setName: inviteState.setName,
    setEmail: inviteState.setEmail,
    setPassword: inviteState.setPassword,
    acceptInvite,
    signIn,
    signInWithProvider,
    createAccount,
    setState: inviteState.setState,
    setPreviewAttempt: inviteState.setPreviewAttempt,
  };
}

// One owner for the invite flow, shared credentials, live refs and idempotency tokens.
export function useInviteAcceptController(token: string | undefined) {
  const { authMode, user, providers: configuredProviders, refreshAuth, signOut } = useAuth();
  const providers = configuredProviders ?? [];
  const flow = useInviteFlow(token, user, refreshAuth);
  return {
    state: flow.state,
    preview: flow.preview,
    user,
    authMode,
    providers,
    busy: flow.busy,
    errorId: flow.errorId,
    name: flow.name,
    email: flow.email,
    password: flow.password,
    flowStatusRef: flow.flowStatusRef,
    continueRef: flow.continueRef,
    onNameChange: flow.setName,
    onEmailChange: flow.setEmail,
    onPasswordChange: flow.setPassword,
    onAccept: () => void flow.acceptInvite(),
    onSignOut: () => void signOut(),
    onSignIn: (event: FormEvent) => void flow.signIn(event),
    onProviderSignIn: (provider: AuthProviderInfo) => void flow.signInWithProvider(provider),
    onCreateAccount: () => void flow.createAccount(),
    onClearAuthError: () => flow.setState({ kind: "auth" }),
    onRetryPreview: () => {
      flow.setState({ kind: "previewing" });
      flow.setPreviewAttempt((attempt) => attempt + 1);
    },
  };
}
