import { ForgotPassword } from "./ForgotPassword";
import { allowsPasswordSignIn, allowsProviderSignIn } from "@capacitylens/shared/account/types";
import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { useEffect, useId, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { ExternalProviderButton } from "@/components/common/ExternalProviderButton";
import type { AuthProviderInfo } from "./authContext";
import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";
import {
  buildExternalSignInErrorUrl,
  clearExternalSignInError,
  hasExternalSignInError,
  readExternalSignInErrorCode,
  resolveExternalSignInErrorMessage,
} from "./externalSignInError";
import { LoginForm } from "./LoginForm";
import { useOwnerSetup } from "./useOwnerSetup";
import { usePasswordSignIn } from "./usePasswordSignIn";
import { startMicrosoftConnection } from "./microsoftConnectionClient";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";

type LoginScreenProps = {
  authMode: "password-only" | "sso-only" | "password-and-sso";
  needsSetup?: boolean;
  passwordResetEmail?: boolean;
  providers?: AuthProviderInfo[];
  degraded?: boolean;
  hadUnsavedChanges?: boolean;
  onSignedIn: () => void;
};

function useLoginIds() {
  return {
    name: useId(),
    email: useId(),
    password: useId(),
    setupToken: useId(),
    setupTokenHelp: useId(),
    error: useId(),
  };
}

export function LoginScreen({
  authMode,
  needsSetup = false,
  passwordResetEmail = false,
  providers = [],
  degraded = false,
  hadUnsavedChanges = false,
  onSignedIn,
}: LoginScreenProps) {
  const [returnedWithExternalError] = useState(() => hasExternalSignInError(window.location.href));
  const [error, setError] = useState<string | null>(() =>
    returnedWithExternalError
      ? resolveExternalSignInErrorMessage(readExternalSignInErrorCode(window.location.href))
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<AuthProviderInfo | null>(null);
  const passwordSignIn = usePasswordSignIn({
    setError,
    setBusy,
    onSignedIn,
  });
  const ownerSetup = useOwnerSetup({
    email: passwordSignIn.email,
    password: passwordSignIn.password,
    setError,
    setBusy,
    onSignedIn,
  });
  const ids = useLoginIds();

  useEffect(() => {
    document.title = `${m.login_sign_in()} · ${APP_NAME}`;
  }, []);
  useEffect(() => {
    if (returnedWithExternalError)
      window.history.replaceState(window.history.state, "", clearExternalSignInError(window.location.href));
  }, [returnedWithExternalError]);

  return (
    <LoginView
      authMode={authMode}
      needsSetup={needsSetup}
      passwordResetEmail={passwordResetEmail}
      providers={allowsProviderSignIn(authMode) ? providers : []}
      degraded={degraded}
      hadUnsavedChanges={hadUnsavedChanges}
      busy={busy}
      pendingProvider={pendingProvider}
      error={error}
      setError={setError}
      ids={ids}
      passwordSignIn={passwordSignIn}
      ownerSetup={ownerSetup}
      signInWithProvider={createProviderSignIn({
        setBusy,
        setError,
        setPendingProvider,
        bootstrap: needsSetup && !ownerSetup.setupClosed,
        email: passwordSignIn.email,
      })}
    />
  );
}

function createProviderSignIn({
  setBusy,
  setError,
  setPendingProvider,
  bootstrap,
  email,
}: {
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setPendingProvider: Dispatch<SetStateAction<AuthProviderInfo | null>>;
  bootstrap: boolean;
  email: string;
}) {
  return async (provider: AuthProviderInfo) => {
    if (provider.id === "microsoft" && bootstrap) {
      const normalizedEmail = normalizeAccountEmail(email);
      if (!isAccountEmail(normalizedEmail)) {
        setError(m.identity_err_email());
        return;
      }
      setBusy(true);
      setError(null);
      setPendingProvider(provider);
      try {
        const result = await startMicrosoftConnection({
          purpose: "bootstrap",
          email: normalizedEmail,
          callbackURL: window.location.href,
          errorCallbackURL: buildExternalSignInErrorUrl(window.location.href),
        });
        window.location.assign(result.data.url);
      } catch {
        setPendingProvider(null);
        setError(m.microsoft_verify_action_failed());
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    setError(null);
    setPendingProvider(provider);
    try {
      const result = await dispatchExternalProviderSignIn(provider);
      if (result.error) {
        setPendingProvider(null);
        setError(result.error.message ?? m.login_failed());
        setBusy(false);
      }
    } catch (error) {
      console.error("LoginScreen: SSO sign-in request failed", error);
      setPendingProvider(null);
      setError(m.login_network_error());
      setBusy(false);
    }
  };
}

type LoginViewProps = {
  authMode: "password-only" | "sso-only" | "password-and-sso";
  needsSetup: boolean;
  passwordResetEmail: boolean;
  providers: AuthProviderInfo[];
  degraded: boolean;
  hadUnsavedChanges: boolean;
  busy: boolean;
  pendingProvider: AuthProviderInfo | null;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  ids: {
    name: string;
    email: string;
    password: string;
    setupToken: string;
    setupTokenHelp: string;
    error: string;
  };
  passwordSignIn: ReturnType<typeof usePasswordSignIn>;
  ownerSetup: ReturnType<typeof useOwnerSetup>;
  signInWithProvider: (provider: AuthProviderInfo) => Promise<void>;
};

function LoginView(props: LoginViewProps) {
  const setup = isOwnerSetupActive(props);
  const { loginProviders, trailingProviders, showLoginProviders, showTrailingProviders, preserveBootstrapFlow } =
    getProviderPlacement(props);
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <LoginHeading setup={setup} />
        <Card className="gap-4 py-4">
          <CardContent className="px-4">
            <LoginNotices degraded={props.degraded} hadUnsavedChanges={props.hadUnsavedChanges} />
            {showLoginProviders && (
              <ProviderButtons
                authMode={props.authMode}
                setup={setup}
                providers={loginProviders}
                busy={props.busy}
                pendingProvider={props.pendingProvider}
                error={props.error}
                signInWithProvider={props.signInWithProvider}
              />
            )}
            {showLoginProviders && allowsPasswordSignIn(props.authMode) && <PasswordFallbackSeparator />}
            <LoginForm
              authMode={props.authMode}
              setup={setup}
              microsoftBootstrap={
                props.authMode === "sso-only" &&
                props.needsSetup &&
                props.providers.some((provider) => provider.id === "microsoft")
              }
              passwordAutoFocus={!showLoginProviders}
              busy={props.busy}
              error={props.error}
              ids={props.ids}
              passwordSignIn={props.passwordSignIn}
              ownerSetup={props.ownerSetup}
            />
            {props.passwordResetEmail && allowsPasswordSignIn(props.authMode) && !setup && <ForgotPassword />}
            {showTrailingProviders && (
              <ProviderButtons
                authMode={props.authMode}
                setup={setup}
                providers={trailingProviders}
                showSeparator={preserveBootstrapFlow}
                errorId={props.ids.error}
                busy={props.busy}
                pendingProvider={props.pendingProvider}
                error={props.error}
                signInWithProvider={props.signInWithProvider}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function isOwnerSetupActive(props: LoginViewProps) {
  return allowsPasswordSignIn(props.authMode) && props.needsSetup && !props.ownerSetup.setupClosed;
}

function getProviderPlacement({
  authMode,
  needsSetup,
  providers,
  ownerSetup,
}: Pick<LoginViewProps, "authMode" | "needsSetup" | "providers" | "ownerSetup">) {
  const preserveBootstrapFlow = needsSetup && !ownerSetup.setupClosed;
  const loginProviders = preserveBootstrapFlow ? [] : providers;
  const trailingProviders = preserveBootstrapFlow ? providers : [];
  return {
    loginProviders,
    trailingProviders,
    preserveBootstrapFlow,
    showLoginProviders: loginProviders.length > 0,
    showTrailingProviders: trailingProviders.length > 0 || (authMode === "sso-only" && providers.length === 0),
  };
}

function LoginHeading({ setup }: { setup: boolean }) {
  return (
    <div className="mb-6 text-center">
      <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
      <h1 className="text-lg font-semibold text-ink">{setup ? m.login_setup_heading() : m.login_sign_in()}</h1>
      {!setup && <p className="text-sm text-muted-foreground">{m.login_subtitle()}</p>}
    </div>
  );
}

function LoginNotices({ degraded, hadUnsavedChanges }: { degraded: boolean; hadUnsavedChanges: boolean }) {
  return (
    <>
      {degraded && (
        <div className="mb-4">
          <Alert variant="warn" role="status">
            <AlertDescription>{m.login_degraded_notice()}</AlertDescription>
          </Alert>
        </div>
      )}
      {hadUnsavedChanges && (
        <div className="mb-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription>{m.login_unsaved_changes_notice()}</AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}

type ProviderButtonsProps = Pick<
  LoginViewProps,
  "authMode" | "providers" | "busy" | "pendingProvider" | "error" | "signInWithProvider"
> & {
  setup: boolean;
  showSeparator?: boolean;
  errorId?: string;
};

function ProviderButtons({
  authMode,
  setup,
  providers,
  busy,
  pendingProvider,
  error,
  showSeparator = false,
  signInWithProvider,
  errorId,
}: ProviderButtonsProps) {
  if (providers.length === 0)
    return !setup && authMode === "sso-only" ? <FieldError>{m.login_sso_unavailable()}</FieldError> : null;
  return (
    <div className="mt-4 flex flex-col gap-3">
      {showSeparator && <Separator />}
      {setup && providers.some((provider) => !provider.experimental) && (
        <p className="text-xs text-muted-foreground">{m.login_setup_external_hint()}</p>
      )}
      {providers.some((provider) => provider.experimental) && (
        <p className="text-xs text-muted-foreground">{m.login_external_experimental()}</p>
      )}
      <FieldError id={errorId}>{authMode === "sso-only" ? error : null}</FieldError>
      {pendingProvider && (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {m.login_external_redirecting({ provider: pendingProvider.label })}
        </p>
      )}
      {providers.map((provider) => (
        <ExternalProviderButton
          size="sm"
          type="button"
          key={`${provider.kind}:${provider.id}`}
          variant="outline"
          provider={provider}
          label={m.login_continue_with({ provider: provider.label })}
          googleLabel={m.login_sign_in_with_google()}
          microsoftLabel={m.login_sign_in_with_microsoft()}
          onClick={() => void signInWithProvider(provider)}
          disabled={busy}
          className="h-10 min-h-10 w-[180px] self-center p-0"
        />
      ))}
    </div>
  );
}

function PasswordFallbackSeparator() {
  return (
    <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
      <Separator className="min-w-0 flex-1 shrink data-[orientation=horizontal]:w-auto" />
      <span className="shrink-0">{m.login_or_use_password()}</span>
      <Separator className="min-w-0 flex-1 shrink data-[orientation=horizontal]:w-auto" />
    </div>
  );
}
