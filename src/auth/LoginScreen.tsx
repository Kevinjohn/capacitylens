import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { useEffect, useId, useState, type Dispatch, type SetStateAction } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Card, CardContent } from "../components/ui/card";
import { FieldError } from "../components/ui/field";
import { Separator } from "../components/ui/separator";
import { ExternalProviderButton } from "../components/common/ExternalProviderButton";
import { hasGoogleProviderBrand, type AuthProviderInfo } from "./authContext";
import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";
import {
  buildExternalSignInErrorUrl,
  clearExternalSignInError,
  hasExternalSignInError,
  readExternalSignInErrorCode,
  resolveExternalSignInErrorMessage,
} from "./externalSignInError";
import { LoginForm } from "./LoginForms";
import { useOwnerSetup } from "./useOwnerSetup";
import { usePasswordSignIn } from "./usePasswordSignIn";
import { useSecondFactor } from "./useSecondFactor";
import { startMicrosoftConnection } from "./microsoftConnectionClient";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";

type LoginScreenProps = {
  authMode: "password" | "sso";
  needsSetup?: boolean;
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
  const secondFactor = useSecondFactor({ setError, setBusy, onSignedIn });
  const passwordSignIn = usePasswordSignIn({
    setError,
    setBusy,
    onSignedIn,
    setTwoFactorPending: secondFactor.setTwoFactorPending,
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
      providers={providers}
      degraded={degraded}
      hadUnsavedChanges={hadUnsavedChanges}
      busy={busy}
      pendingProvider={pendingProvider}
      error={error}
      setError={setError}
      ids={ids}
      secondFactor={secondFactor}
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
  authMode: "password" | "sso";
  needsSetup: boolean;
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
  secondFactor: ReturnType<typeof useSecondFactor>;
  passwordSignIn: ReturnType<typeof usePasswordSignIn>;
  ownerSetup: ReturnType<typeof useOwnerSetup>;
  signInWithProvider: (provider: AuthProviderInfo) => Promise<void>;
};

function LoginView(props: LoginViewProps) {
  const setup = props.authMode === "password" && props.needsSetup && !props.ownerSetup.setupClosed;
  const promotedGoogle = props.providers.find(hasGoogleProviderBrand);
  const promotedProviders =
    !setup && props.authMode === "password"
      ? props.providers.filter((provider) => provider === promotedGoogle || provider.id === "microsoft")
      : [];
  const trailingProviders = props.providers.filter((provider) => !promotedProviders.includes(provider));
  const showPromotedProviders = promotedProviders.length > 0 && !props.secondFactor.twoFactorPending;
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <LoginHeading setup={setup} />
        <Card className="gap-4 py-4">
          <CardContent className="px-4">
            <LoginNotices degraded={props.degraded} hadUnsavedChanges={props.hadUnsavedChanges} />
            {showPromotedProviders && (
              <ProviderButtons
                authMode={props.authMode}
                setup={setup}
                providers={promotedProviders}
                busy={props.busy}
                pendingProvider={props.pendingProvider}
                error={props.error}
                twoFactorPending={props.secondFactor.twoFactorPending}
                signInWithProvider={props.signInWithProvider}
                showSeparator={false}
                surroundButtons
              />
            )}
            {showPromotedProviders && <PasswordFallbackSeparator />}
            <LoginForm
              authMode={props.authMode}
              setup={setup}
              microsoftBootstrap={
                props.authMode === "sso" &&
                props.needsSetup &&
                props.providers.some((provider) => provider.id === "microsoft")
              }
              passwordAutoFocus={!showPromotedProviders}
              busy={props.busy}
              error={props.error}
              setError={props.setError}
              ids={props.ids}
              secondFactor={props.secondFactor}
              passwordSignIn={props.passwordSignIn}
              ownerSetup={props.ownerSetup}
            />
            <ProviderButtons
              authMode={props.authMode}
              setup={setup}
              providers={trailingProviders}
              errorId={props.ids.error}
              busy={props.busy}
              pendingProvider={props.pendingProvider}
              error={props.error}
              twoFactorPending={props.secondFactor.twoFactorPending}
              signInWithProvider={props.signInWithProvider}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
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
  twoFactorPending: boolean;
  showSeparator?: boolean;
  surroundButtons?: boolean;
  errorId?: string;
};

function ProviderButtons({
  authMode,
  setup,
  providers,
  busy,
  pendingProvider,
  error,
  twoFactorPending,
  signInWithProvider,
  showSeparator = true,
  surroundButtons,
  errorId,
}: ProviderButtonsProps) {
  if (twoFactorPending) return null;
  if (providers.length === 0)
    return !setup && authMode === "sso" ? <FieldError>{m.login_sso_unavailable()}</FieldError> : null;
  const hasSupportingText = providerButtonsHaveSupportingText({
    authMode,
    error,
    pendingProvider,
    providers,
    setup,
  });
  return (
    <div className="mt-4 flex flex-col gap-3">
      {showSeparator && <Separator />}
      {setup && providers.some((provider) => !provider.experimental) && (
        <p className="text-xs text-muted-foreground">{m.login_setup_external_hint()}</p>
      )}
      {providers.some((provider) => provider.experimental) && (
        <p className="text-xs text-muted-foreground">{m.login_external_experimental()}</p>
      )}
      <FieldError id={errorId}>{authMode === "sso" ? error : null}</FieldError>
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
          className={providerButtonSpacingClass(surroundButtons, hasSupportingText)}
        />
      ))}
    </div>
  );
}

function providerButtonSpacingClass(surroundButtons: boolean | undefined, hasSupportingText: boolean) {
  if (!surroundButtons) return undefined;
  return hasSupportingText ? "mt-5 mb-4" : "mb-4";
}

function providerButtonsHaveSupportingText({
  authMode,
  error,
  pendingProvider,
  providers,
  setup,
}: Pick<ProviderButtonsProps, "authMode" | "error" | "pendingProvider" | "providers" | "setup">) {
  return (
    (setup && providers.some((provider) => !provider.experimental)) ||
    providers.some((provider) => provider.experimental) ||
    (authMode === "sso" && Boolean(error)) ||
    pendingProvider !== null
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
