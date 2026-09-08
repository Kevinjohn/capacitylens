import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { MAX_PASSWORD_INPUT_CODE_UNITS, MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { MAX_EMAIL_LENGTH, MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { useEffect, useId, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { FieldError, FieldGroup } from "../components/ui/field";
import { Separator } from "../components/ui/separator";
import type { AuthProviderInfo } from "./authContext";
import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";
import {
  clearExternalSignInError,
  readExternalSignInErrorCode,
  resolveExternalSignInErrorMessage,
  hasExternalSignInError,
} from "./externalSignInError";
import { LoginField } from "./LoginField";
import { useOwnerSetup } from "./useOwnerSetup";
import { usePasswordSignIn } from "./usePasswordSignIn";
import { useSecondFactor } from "./useSecondFactor";

// The flag-gated login wall (production plan P3.3; US-NAV-10). Only ever rendered when
// the server reports authMode 'password' or 'sso' AND there is no session — the default
// deploy (auth off) and the demo build never see it. Driven by Better Auth's React client.
// The ONE sign-up form is the first-run owner setup: when the server reports `needsSetup`
// (password mode + zero users — sign-up requires the operator's setup token),
// the screen offers "Create the owner account" instead of a dead-end sign-in; every other
// password identity is created through a valid invite (self-registration stays closed).

type LoginScreenProps = {
  authMode: "password" | "sso";
  /** Server-reported first-run state (password mode + empty user table). Fail-closed default:
   *  absent means the ordinary sign-in form. */
  needsSetup?: boolean;
  providers?: AuthProviderInfo[];
  /** True when AuthProvider fell back to this form because the 401 body itself was untrustworthy
   *  (non-JSON/HTML/junk authMode), not because the server genuinely reported password mode. Shows
   *  a non-terminal advisory above the form — see AuthProvider's Status.degraded doc comment. */
  degraded?: boolean;
  /** A mid-session 401 replaced an app whose server persistence still held unsaved writes. */
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
  // Stable ids so each input can point at the shared error message (WCAG 3.3.1). A sign-in
  // failure is form-level (not field-specific), so we describe BOTH inputs by the one error and
  // skip aria-invalid — describedby is what re-announces the reason as the user navigates back.
  const ids = { name: useId(), email: useId(), password: useId(), setupToken: useId(), error: useId() };

  // This wall replaces the router, so AppShell cannot replace a stale in-app route title after a
  // session expires. Keep the tab's purpose explicit, matching the other public auth entries.
  useEffect(() => {
    document.title = `${m.login_sign_in()} · ${APP_NAME}`;
  }, []);

  useEffect(() => {
    if (!returnedWithExternalError) return;
    window.history.replaceState(window.history.state, "", clearExternalSignInError(window.location.href));
  }, [returnedWithExternalError]);

  const signInWithProvider = createProviderSignIn(setBusy, setError);

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
      signInWithProvider={signInWithProvider}
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
      // On success the client follows the provider redirect; only a failure returns here.
      const result = await dispatchExternalProviderSignIn(provider);
      const failure = result.error;
      if (failure) {
        setError(failure.message ?? m.login_failed());
        setBusy(false);
      } else {
        // Redirect-based success should unload this document. If an adapter resolves without
        // navigating, restore a retryable login wall instead of leaving every control disabled.
        setError(m.login_sso_failed());
        setBusy(false);
      }
    } catch (error) {
      // Same as the password path: a thrown (pre-redirect) network error would otherwise strand the
      // button disabled with no feedback. Surface it and reset busy.
      console.error("LoginScreen: SSO sign-in request failed", error);
      setError(m.login_network_error());
      setBusy(false);
    }
  };
}

type LoginIds = { name: string; email: string; password: string; setupToken: string; error: string };
type LoginViewProps = {
  authMode: "password" | "sso";
  needsSetup: boolean;
  providers: AuthProviderInfo[];
  degraded: boolean;
  hadUnsavedChanges: boolean;
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  ids: LoginIds;
  secondFactor: ReturnType<typeof useSecondFactor>;
  passwordSignIn: ReturnType<typeof usePasswordSignIn>;
  ownerSetup: ReturnType<typeof useOwnerSetup>;
  signInWithProvider: (provider: AuthProviderInfo) => Promise<void>;
};

function LoginView(props: LoginViewProps) {
  const setup = props.authMode === "password" && props.needsSetup && !props.ownerSetup.setupClosed;
  const heading = setup ? m.login_setup_heading() : m.login_sign_in();
  const subtitle = setup ? m.login_setup_subtitle() : m.login_subtitle();

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">{heading}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
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

type LoginFormProps = {
  authMode: "password" | "sso";
  setup: boolean;
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  ids: LoginIds;
  secondFactor: {
    twoFactorPending: boolean;
    twoFactorCode: string;
    setTwoFactorCode: Dispatch<SetStateAction<string>>;
    useRecoveryCode: boolean;
    setUseRecoveryCode: Dispatch<SetStateAction<boolean>>;
    verifySecondFactor: (e: FormEvent) => Promise<void>;
  };
  passwordSignIn: {
    email: string;
    setEmail: Dispatch<SetStateAction<string>>;
    password: string;
    setPassword: Dispatch<SetStateAction<string>>;
    signInWithPassword: (e: FormEvent) => Promise<void>;
  };
  ownerSetup: {
    name: string;
    setName: Dispatch<SetStateAction<string>>;
    setupToken: string;
    setSetupToken: Dispatch<SetStateAction<string>>;
    createOwner: (e: FormEvent) => Promise<void>;
  };
};

function LoginForm(props: LoginFormProps) {
  if (props.secondFactor.twoFactorPending) {
    return (
      <SecondFactorForm
        busy={props.busy}
        error={props.error}
        setError={props.setError}
        errorId={props.ids.error}
        twoFactorCode={props.secondFactor.twoFactorCode}
        setTwoFactorCode={props.secondFactor.setTwoFactorCode}
        useRecoveryCode={props.secondFactor.useRecoveryCode}
        setUseRecoveryCode={props.secondFactor.setUseRecoveryCode}
        verifySecondFactor={props.secondFactor.verifySecondFactor}
      />
    );
  }
  if (props.setup) {
    return (
      <OwnerSetupForm
        busy={props.busy}
        error={props.error}
        ids={props.ids}
        name={props.ownerSetup.name}
        setName={props.ownerSetup.setName}
        setupToken={props.ownerSetup.setupToken}
        setSetupToken={props.ownerSetup.setSetupToken}
        createOwner={props.ownerSetup.createOwner}
        email={props.passwordSignIn.email}
        setEmail={props.passwordSignIn.setEmail}
        password={props.passwordSignIn.password}
        setPassword={props.passwordSignIn.setPassword}
      />
    );
  }
  if (props.authMode === "password") {
    return (
      <PasswordForm
        busy={props.busy}
        error={props.error}
        emailId={props.ids.email}
        passwordId={props.ids.password}
        errorId={props.ids.error}
        email={props.passwordSignIn.email}
        setEmail={props.passwordSignIn.setEmail}
        password={props.passwordSignIn.password}
        setPassword={props.passwordSignIn.setPassword}
        signInWithPassword={props.passwordSignIn.signInWithPassword}
      />
    );
  }
  return null;
}

type SecondFactorFormProps = {
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  errorId: string;
  twoFactorCode: string;
  setTwoFactorCode: Dispatch<SetStateAction<string>>;
  useRecoveryCode: boolean;
  setUseRecoveryCode: Dispatch<SetStateAction<boolean>>;
  verifySecondFactor: (e: FormEvent) => Promise<void>;
};

function SecondFactorForm({
  busy,
  error,
  setError,
  errorId,
  twoFactorCode,
  setTwoFactorCode,
  useRecoveryCode,
  setUseRecoveryCode,
  verifySecondFactor,
}: SecondFactorFormProps) {
  const prompt = useRecoveryCode ? m.login_mfa_recovery_prompt() : m.login_mfa_authenticator_prompt();
  const label = useRecoveryCode ? m.login_mfa_recovery_code() : m.login_mfa_authentication_code();
  const toggleLabel = useRecoveryCode ? m.login_mfa_use_authenticator() : m.login_mfa_use_recovery();
  return (
    <form onSubmit={(e) => void verifySecondFactor(e)} noValidate>
      <FieldGroup className="gap-3">
        <p className="text-sm text-muted-foreground">{prompt}</p>
        <LoginField
          id="mfa-code"
          label={label}
          data-testid="mfa-code"
          type="text"
          inputMode={useRecoveryCode ? "text" : "numeric"}
          autoComplete="one-time-code"
          value={twoFactorCode}
          onChange={(e) => setTwoFactorCode(e.target.value.trim())}
          aria-describedby={error ? errorId : undefined}
          autoFocus
        />
        <FieldError id={errorId}>{error}</FieldError>
        <div className="flex items-center justify-between gap-3">
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => {
              setUseRecoveryCode((value) => !value);
              setTwoFactorCode("");
              setError(null);
            }}
          >
            {toggleLabel}
          </Button>
          <Button size="sm" type="submit" data-testid="mfa-submit" disabled={busy || twoFactorCode.length === 0}>
            {m.login_mfa_verify()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

type OwnerSetupFormProps = {
  busy: boolean;
  error: string | null;
  ids: LoginIds;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  setupToken: string;
  setSetupToken: Dispatch<SetStateAction<string>>;
  createOwner: (e: FormEvent) => Promise<void>;
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
};

function OwnerSetupForm({
  busy,
  error,
  ids,
  name,
  setName,
  setupToken,
  setSetupToken,
  createOwner,
  email,
  setEmail,
  password,
  setPassword,
}: OwnerSetupFormProps) {
  return (
    <form onSubmit={(e) => void createOwner(e)} noValidate>
      <FieldGroup className="gap-3">
        <LoginField
          id={ids.name}
          label={m.login_name()}
          data-testid="owner-setup-name"
          type="text"
          autoComplete="name"
          value={name}
          maxLength={MAX_NAME_INPUT_CODE_UNITS}
          onChange={(e) => setName(e.target.value)}
          // Same form-level error contract as sign-in: describe every field by the one
          // error only while it's showing (WCAG 3.3.1).
          aria-describedby={error ? ids.error : undefined}
          autoFocus
        />
        <LoginField
          id={ids.email}
          label={m.login_email()}
          data-testid="owner-setup-email"
          type="email"
          autoComplete="email"
          value={email}
          maxLength={MAX_EMAIL_LENGTH}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={error ? ids.error : undefined}
        />
        <LoginField
          id={ids.password}
          label={m.login_password()}
          data-testid="owner-setup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={error ? ids.error : undefined}
        />
        <LoginField
          id={ids.setupToken}
          label={m.login_setup_token()}
          data-testid="owner-setup-token"
          type="password"
          autoComplete="off"
          value={setupToken}
          onChange={(e) => setSetupToken(e.target.value)}
          placeholder={m.login_setup_token_placeholder()}
          aria-describedby={error ? ids.error : undefined}
        />
        <FieldError id={ids.error}>{error}</FieldError>
        <div className="flex justify-end">
          <Button size="sm" type="submit" data-testid="owner-setup-submit" disabled={busy}>
            {m.login_create_owner()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

type PasswordFormProps = {
  busy: boolean;
  error: string | null;
  emailId: string;
  passwordId: string;
  errorId: string;
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  password: string;
  setPassword: Dispatch<SetStateAction<string>>;
  signInWithPassword: (e: FormEvent) => Promise<void>;
};

function PasswordForm({
  busy,
  error,
  emailId,
  passwordId,
  errorId,
  email,
  setEmail,
  password,
  setPassword,
  signInWithPassword,
}: PasswordFormProps) {
  return (
    <form onSubmit={(e) => void signInWithPassword(e)} noValidate>
      <FieldGroup className="gap-3">
        <LoginField
          id={emailId}
          label={m.login_email()}
          type="email"
          autoComplete="email"
          value={email}
          maxLength={MAX_EMAIL_LENGTH}
          onChange={(e) => setEmail(e.target.value)}
          // Describe by the form-level error only while it's showing, so the reason is
          // re-announced when focus returns to this field (WCAG 3.3.1).
          aria-describedby={error ? errorId : undefined}
          autoFocus
        />
        <LoginField
          id={passwordId}
          label={m.login_password()}
          type="password"
          autoComplete="current-password"
          value={password}
          maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={error ? errorId : undefined}
        />
        <FieldError id={errorId}>{error}</FieldError>
        <div className="flex justify-end">
          <Button size="sm" type="submit" disabled={busy}>
            {m.login_sign_in()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

type ProviderButtonsProps = {
  authMode: "password" | "sso";
  setup: boolean;
  providers: AuthProviderInfo[];
  busy: boolean;
  error: string | null;
  twoFactorPending: boolean;
  signInWithProvider: (provider: AuthProviderInfo) => Promise<void>;
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
  if (providers.length === 0) {
    return !setup && authMode === "sso" ? <FieldError>{m.login_sso_unavailable()}</FieldError> : null;
  }
  const hasExperimentalProvider = providers.some((provider) => provider.experimental);
  return (
    <div className="mt-4 flex flex-col gap-3">
      <Separator />
      {hasExperimentalProvider ? (
        <p className="text-xs text-muted-foreground">{m.login_external_experimental()}</p>
      ) : null}
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
