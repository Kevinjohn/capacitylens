import { useEffect, useId, useState, type ComponentProps } from "react";
import type { FormEvent } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "../components/ui/field";
import { Card, CardContent } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { authClient } from "./authClient";
import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m } from "@/i18n";
import type { AuthProviderInfo } from "./authContext";
import { validateText } from "../lib/validation";
import { MAX_EMAIL_LENGTH, MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_PASSWORD_INPUT_CODE_UNITS,
  passwordLengthFailure,
} from "@capacitylens/shared/domain/password";
import {
  clearExternalSignInError,
  externalSignInErrorCode,
  externalSignInErrorMessage,
  hasExternalSignInError,
} from "./externalSignInError";

function LoginField({ id, label, ...props }: ComponentProps<typeof Input> & { id: string; label: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
    </Field>
  );
}

// The flag-gated login wall (production plan P3.3; US-NAV-10). Only ever rendered when
// the server reports authMode 'password' or 'sso' AND there is no session — the default
// deploy (auth off) and the demo build never see it. Driven by Better Auth's React client.
// The ONE sign-up form is the first-run owner setup: when the server reports `needsSetup`
// (password mode + zero users — sign-up requires the operator's setup token),
// the screen offers "Create the owner account" instead of a dead-end sign-in; every other
// password identity is created through a valid invite (self-registration stays closed).

export function LoginScreen({
  authMode,
  needsSetup = false,
  providers = [],
  degraded = false,
  hadUnsavedChanges = false,
  onSignedIn,
}: {
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
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [returnedWithExternalError] = useState(() => hasExternalSignInError(window.location.href));
  const [error, setError] = useState<string | null>(() =>
    returnedWithExternalError ? externalSignInErrorMessage(externalSignInErrorCode(window.location.href)) : null,
  );
  const [busy, setBusy] = useState(false);
  const [twoFactorPending, setTwoFactorPending] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  // Flips true the moment OUR owner-setup submit is refused because someone else's setup
  // already won the race (server's live per-request gate — see server/src/auth.ts). needsSetup
  // is a one-time snapshot from page load, so a second tab/operator can still see the create-owner
  // form after the workspace is bootstrapped; this local override forces the ordinary sign-in
  // form instead of leaving the loser stuck on a dead-end create-owner form. Never flips back.
  const [setupClosed, setSetupClosed] = useState(false);
  // Stable ids so each input can point at the shared error message (WCAG 3.3.1). A sign-in
  // failure is form-level (not field-specific), so we describe BOTH inputs by the one error and
  // skip aria-invalid — describedby is what re-announces the reason as the user navigates back.
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const setupTokenId = useId();
  const errorId = useId();
  const setup = authMode === "password" && needsSetup && !setupClosed;

  // This wall replaces the router, so AppShell cannot replace a stale in-app route title after a
  // session expires. Keep the tab's purpose explicit, matching the other public auth entries.
  useEffect(() => {
    document.title = `${m.login_sign_in()} · ${APP_NAME}`;
  }, []);

  useEffect(() => {
    if (!returnedWithExternalError) return;
    window.history.replaceState(window.history.state, "", clearExternalSignInError(window.location.href));
  }, [returnedWithExternalError]);

  const signInWithPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data, error: failure } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
      if (failure) {
        setError(failure.message ?? m.login_failed());
        setBusy(false);
        return;
      }
      if ((data as { twoFactorRedirect?: unknown } | null)?.twoFactorRedirect === true) {
        setTwoFactorPending(true);
        setBusy(false);
        return;
      }
      onSignedIn();
    } catch (err) {
      // Better Auth returns an auth FAILURE as { error } (handled above). A THROW here is a
      // pre-response network/transport error — without this catch `busy` stayed true forever (button
      // stuck disabled, no message). Surface a generic message + reset busy; log the real cause.
      console.error("LoginScreen: password sign-in request failed", err);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  const verifySecondFactor = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = useRecoveryCode
        ? await authClient.twoFactor.verifyBackupCode({
            code: twoFactorCode,
            trustDevice: false,
          })
        : await authClient.twoFactor.verifyTotp({
            code: twoFactorCode,
            trustDevice: false,
          });
      if (result.error) {
        setError(result.error.message ?? m.login_failed());
        setBusy(false);
        return;
      }
      onSignedIn();
    } catch (err) {
      console.error("LoginScreen: second-factor verification failed", err);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  const createOwner = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = validateText(name, (_field, message) => setError(message), {
      field: "name",
      requiredMessage: m.identity_err_name(),
    });
    if (cleanName === null) return;
    const cleanEmail = normalizeAccountEmail(email);
    if (!isAccountEmail(cleanEmail)) {
      setError(m.identity_err_email());
      return;
    }
    if (passwordLengthFailure(password)) {
      setError(
        m.identity_err_password({
          min: MIN_PASSWORD_LENGTH,
          max: MAX_PASSWORD_LENGTH,
        }),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Better Auth auto-signs-in on sign-up, so success proceeds exactly like a sign-in:
      // onSignedIn() reloads and the boot re-check finds the fresh session cookie.
      const { error: failure } = await authClient.signUp.email({
        email: cleanEmail,
        password,
        name: cleanName,
        fetchOptions: { headers: { "x-capacitylens-setup-token": setupToken } },
      });
      if (failure) {
        // The live per-request gate (server/src/auth.ts) closes the instant a user exists, so a
        // second tab/operator racing our own first-run setup gets refused with this EXACT typed
        // code — Better Auth's disableSignUp shape, reused verbatim by our hook. That's the ONE
        // failure that isn't really "your input was wrong": someone else already finished setup,
        // so drop out of setup mode into ordinary sign-in rather than leave the loser stuck on a
        // dead-end create-owner form with no recovery but a manual reload.
        if (failure.code === "EMAIL_PASSWORD_SIGN_UP_DISABLED") {
          setError(m.login_setup_taken());
          setSetupClosed(true);
          setBusy(false);
          return;
        }
        // Any other reason (e.g. password too short) — surface Better Auth's own message; a
        // generic message would hide the fix.
        setError(failure.message ?? m.login_setup_failed());
        setBusy(false);
        return;
      }
      onSignedIn();
    } catch (err) {
      // Same contract as the sign-in path: a THROW is a pre-response network/transport error —
      // surface a generic message + reset busy so the button never sticks disabled; log the cause.
      console.error("LoginScreen: owner-setup sign-up request failed", err);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  const signInWithProvider = async (provider: AuthProviderInfo) => {
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
    } catch (err) {
      // Same as the password path: a thrown (pre-redirect) network error would otherwise strand the
      // button disabled with no feedback. Surface it and reset busy.
      console.error("LoginScreen: SSO sign-in request failed", err);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">{setup ? m.login_setup_heading() : m.login_sign_in()}</h1>
          <p className="text-sm text-muted-foreground">{setup ? m.login_setup_subtitle() : m.login_subtitle()}</p>
        </div>
        <Card className="gap-4 py-4">
          <CardContent className="px-4">
            {/* Non-terminal advisory (§1 DEFENSIVE-CODING.md — surface, never swallow): the 401 body
              itself was untrustworthy, so this password form is a guess, not a confirmed signal.
              Never rendered for a well-formed password-mode 401 or a valid SSO body — see
              AuthProvider.Status.degraded. */}
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
            {twoFactorPending ? (
              <form onSubmit={(e) => void verifySecondFactor(e)} noValidate>
                <FieldGroup className="gap-3">
                  <p className="text-sm text-muted-foreground">
                    {useRecoveryCode ? m.login_mfa_recovery_prompt() : m.login_mfa_authenticator_prompt()}
                  </p>
                  <LoginField
                    id="mfa-code"
                    label={useRecoveryCode ? m.login_mfa_recovery_code() : m.login_mfa_authentication_code()}
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
                      {useRecoveryCode ? m.login_mfa_use_authenticator() : m.login_mfa_use_recovery()}
                    </Button>
                    <Button
                      size="sm"
                      type="submit"
                      data-testid="mfa-submit"
                      disabled={busy || twoFactorCode.length === 0}
                    >
                      {m.login_mfa_verify()}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
            ) : setup ? (
              <form onSubmit={(e) => void createOwner(e)} noValidate>
                <FieldGroup className="gap-3">
                  <LoginField
                    id={nameId}
                    label={m.login_name()}
                    data-testid="owner-setup-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    maxLength={MAX_NAME_INPUT_CODE_UNITS}
                    onChange={(e) => setName(e.target.value)}
                    // Same form-level error contract as sign-in: describe every field by the one
                    // error only while it's showing (WCAG 3.3.1).
                    aria-describedby={error ? errorId : undefined}
                    autoFocus
                  />
                  <LoginField
                    id={emailId}
                    label={m.login_email()}
                    data-testid="owner-setup-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    maxLength={MAX_EMAIL_LENGTH}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-describedby={error ? errorId : undefined}
                  />
                  <LoginField
                    id={passwordId}
                    label={m.login_password()}
                    data-testid="owner-setup-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    minLength={MIN_PASSWORD_LENGTH}
                    maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-describedby={error ? errorId : undefined}
                  />
                  <LoginField
                    id={setupTokenId}
                    label={m.login_setup_token()}
                    data-testid="owner-setup-token"
                    type="password"
                    autoComplete="off"
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                    placeholder={m.login_setup_token_placeholder()}
                    aria-describedby={error ? errorId : undefined}
                  />
                  <FieldError id={errorId}>{error}</FieldError>
                  <div className="flex justify-end">
                    <Button size="sm" type="submit" data-testid="owner-setup-submit" disabled={busy}>
                      {m.login_create_owner()}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
            ) : authMode === "password" ? (
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
            ) : null}
            {!twoFactorPending && providers.length > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                <Separator />
                {providers.some((provider) => provider.experimental) ? (
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
            )}
            {!setup && authMode === "sso" && providers.length === 0 && (
              <FieldError>{m.login_sso_unavailable()}</FieldError>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
