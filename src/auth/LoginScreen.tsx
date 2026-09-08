import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { useEffect, useId, useState, type Dispatch, type SetStateAction } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { FieldError } from "../components/ui/field";
import { Separator } from "../components/ui/separator";
import type { AuthProviderInfo } from "./authContext";
import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";
import {
  clearExternalSignInError,
  hasExternalSignInError,
  readExternalSignInErrorCode,
  resolveExternalSignInErrorMessage,
} from "./externalSignInError";
import { LoginForm } from "./LoginForms";
import { useOwnerSetup } from "./useOwnerSetup";
import { usePasswordSignIn } from "./usePasswordSignIn";
import { useSecondFactor } from "./useSecondFactor";

type LoginScreenProps = {
  authMode: "password" | "sso";
  needsSetup?: boolean;
  providers?: AuthProviderInfo[];
  degraded?: boolean;
  hadUnsavedChanges?: boolean;
  onSignedIn: () => void;
};

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
  const ids = { name: useId(), email: useId(), password: useId(), setupToken: useId(), error: useId() };

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
      error={error}
      setError={setError}
      ids={ids}
      secondFactor={secondFactor}
      passwordSignIn={passwordSignIn}
      ownerSetup={ownerSetup}
      signInWithProvider={createProviderSignIn(setBusy, setError)}
    />
  );
}

function createProviderSignIn(
  setBusy: Dispatch<SetStateAction<boolean>>,
  setError: Dispatch<SetStateAction<string | null>>,
) {
  return async (provider: AuthProviderInfo) => {
    setBusy(true);
    setError(null);
    try {
      const result = await dispatchExternalProviderSignIn(provider);
      if (result.error) setError(result.error.message ?? m.login_failed());
      else setError(m.login_sso_failed());
    } catch (error) {
      console.error("LoginScreen: SSO sign-in request failed", error);
      setError(m.login_network_error());
    }
    setBusy(false);
  };
}

type LoginViewProps = {
  authMode: "password" | "sso";
  needsSetup: boolean;
  providers: AuthProviderInfo[];
  degraded: boolean;
  hadUnsavedChanges: boolean;
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  ids: { name: string; email: string; password: string; setupToken: string; error: string };
  secondFactor: ReturnType<typeof useSecondFactor>;
  passwordSignIn: ReturnType<typeof usePasswordSignIn>;
  ownerSetup: ReturnType<typeof useOwnerSetup>;
  signInWithProvider: (provider: AuthProviderInfo) => Promise<void>;
};

function LoginView(props: LoginViewProps) {
  const setup = props.authMode === "password" && props.needsSetup && !props.ownerSetup.setupClosed;
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <LoginHeading setup={setup} />
        <Card className="gap-4 py-4">
          <CardContent className="px-4">
            <LoginNotices degraded={props.degraded} hadUnsavedChanges={props.hadUnsavedChanges} />
            <LoginForm
              authMode={props.authMode}
              setup={setup}
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
              providers={props.providers}
              busy={props.busy}
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
      <p className="text-sm text-muted-foreground">{setup ? m.login_setup_subtitle() : m.login_subtitle()}</p>
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

type ProviderButtonsProps = Pick<LoginViewProps, "authMode" | "providers" | "busy" | "error" | "signInWithProvider"> & {
  setup: boolean;
  twoFactorPending: boolean;
};

function ProviderButtons({
  authMode,
  setup,
  providers,
  busy,
  error,
  twoFactorPending,
  signInWithProvider,
}: ProviderButtonsProps) {
  if (twoFactorPending) return null;
  if (providers.length === 0)
    return !setup && authMode === "sso" ? <FieldError>{m.login_sso_unavailable()}</FieldError> : null;
  return (
    <div className="mt-4 flex flex-col gap-3">
      <Separator />
      {providers.some((provider) => provider.experimental) && (
        <p className="text-xs text-muted-foreground">{m.login_external_experimental()}</p>
      )}
      <FieldError>{authMode === "sso" ? error : null}</FieldError>
      {providers.map((provider) => (
        <Button
          size="sm"
          type="button"
          key={`${provider.kind}:${provider.id}`}
          variant="outline"
          onClick={() => void signInWithProvider(provider)}
          disabled={busy}
        >
          {m.login_continue_with({ provider: provider.label })}
        </Button>
      ))}
    </div>
  );
}
