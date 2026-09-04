import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { MAX_PASSWORD_INPUT_CODE_UNITS, MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { MAX_EMAIL_LENGTH, MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { useEffect, useId, useState } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { FieldError, FieldGroup } from "../components/ui/field";
import { Separator } from "../components/ui/separator";
import type { AuthProviderInfo } from "./authContext";
import { dispatchExternalProviderSignIn } from "./externalProviderSignIn";
import {
  clearExternalSignInError,
  externalSignInErrorCode,
  externalSignInErrorMessage,
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
  const [returnedWithExternalError] = useState(() => hasExternalSignInError(window.location.href));
  const [error, setError] = useState<string | null>(() =>
    returnedWithExternalError ? externalSignInErrorMessage(externalSignInErrorCode(window.location.href)) : null,
  );
  const [busy, setBusy] = useState(false);
  const {
    twoFactorPending,
    setTwoFactorPending,
    twoFactorCode,
    setTwoFactorCode,
    useRecoveryCode,
    setUseRecoveryCode,
    verifySecondFactor,
  } = useSecondFactor({ setError, setBusy, onSignedIn });
  const { email, setEmail, password, setPassword, signInWithPassword } = usePasswordSignIn({
    setError,
    setBusy,
    onSignedIn,
    setTwoFactorPending,
  });
  const { name, setName, setupToken, setSetupToken, setupClosed, createOwner } = useOwnerSetup({
    email,
    password,
    setError,
    setBusy,
    onSignedIn,
  });
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
