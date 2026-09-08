import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { APP_NAME } from "@capacitylens/shared/brand";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { authClient } from "./authClient";
import type { PublicAuthEntry } from "./authEntryRoute";
import { m } from "@/i18n";

type Setup = { totpURI: string; backupCodes: string[] };

/** Decode the auth HTTP boundary before a malformed success can replace the recoverable form. */
function parseMfaSetup(value: unknown): Setup | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("totpURI" in value) || !("backupCodes" in value)) return null;
  const { totpURI, backupCodes } = value;
  if (typeof totpURI !== "string" || totpURI.trim().length === 0) return null;
  const parsedBackupCodes = parseBackupCodes(backupCodes);
  return parsedBackupCodes ? { totpURI, backupCodes: parsedBackupCodes } : null;
}

function parseBackupCodes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsedBackupCodes: string[] = [];
  for (const backupCode of value) {
    if (typeof backupCode !== "string" || backupCode.trim().length === 0) return null;
    parsedBackupCodes.push(backupCode);
  }
  return parsedBackupCodes;
}

type StartFormProps = {
  busy: boolean;
  error: string | null;
  errorId: string;
  onPasswordChange: (password: string) => void;
  onSignOut: () => void;
  onSubmit: (event: FormEvent) => void;
  password: string;
};

function StartForm({ busy, error, errorId, onPasswordChange, onSignOut, onSubmit, password }: StartFormProps) {
  return (
    <form onSubmit={onSubmit}>
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor="mfa-enroll-password">{m.mfa_enrollment_current_password()}</FieldLabel>
          <Input
            id="mfa-enroll-password"
            data-testid="mfa-enroll-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          <FieldDescription>{m.mfa_enrollment_password_hint()}</FieldDescription>
        </Field>
        <FieldError id={errorId}>{error}</FieldError>
        <div className="flex items-center justify-between">
          <Button size="sm" type="button" variant="outline" onClick={onSignOut}>
            {m.common_sign_out()}
          </Button>
          <Button size="sm" type="submit" disabled={busy}>
            {m.common_continue()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

type VerificationFormProps = {
  busy: boolean;
  code: string;
  error: string | null;
  errorId: string;
  onCodeChange: (code: string) => void;
  onSavedChange: (saved: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  saved: boolean;
  setup: Setup;
};

function VerificationForm(props: VerificationFormProps) {
  const { busy, code, error, errorId, onCodeChange, onSavedChange, onSubmit, saved, setup } = props;
  return (
    <form onSubmit={onSubmit}>
      <FieldGroup className="gap-4">
        <AuthenticatorSetup totpURI={setup.totpURI} />
        <RecoveryCodeSetup backupCodes={setup.backupCodes} saved={saved} onSavedChange={onSavedChange} />
        <Field>
          <FieldLabel htmlFor="mfa-enroll-code">{m.mfa_enrollment_step_code()}</FieldLabel>
          <Input
            id="mfa-enroll-code"
            data-testid="mfa-enroll-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(event) => onCodeChange(event.target.value.trim())}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </Field>
        <FieldError id={errorId}>{error}</FieldError>
        <Button size="sm" type="submit" data-testid="mfa-enroll-submit" disabled={busy || !saved || code.length !== 6}>
          {m.mfa_enrollment_enable()}
        </Button>
      </FieldGroup>
    </form>
  );
}

function AuthenticatorSetup({ totpURI }: { totpURI: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-ink">{m.mfa_enrollment_step_authenticator()}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{m.mfa_enrollment_authenticator_hint()}</p>
      <a className="mt-2 block break-all rounded bg-canvas p-2 font-mono text-xs text-brand underline" href={totpURI}>
        {totpURI}
      </a>
    </div>
  );
}

function RecoveryCodeSetup({
  backupCodes,
  onSavedChange,
  saved,
}: {
  backupCodes: string[];
  onSavedChange: (saved: boolean) => void;
  saved: boolean;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-ink">{m.mfa_enrollment_step_recovery()}</h2>
      <ul className="mt-2 grid grid-cols-2 gap-1 rounded bg-canvas p-3 font-mono text-xs text-ink">
        {backupCodes.map((backupCode) => (
          <li key={backupCode}>{backupCode}</li>
        ))}
      </ul>
      <Field orientation="horizontal">
        <Checkbox id="mfa-codes-saved" checked={saved} onCheckedChange={(checked) => onSavedChange(checked === true)} />
        <FieldContent>
          <FieldLabel htmlFor="mfa-codes-saved">{m.mfa_enrollment_recovery_saved()}</FieldLabel>
        </FieldContent>
      </Field>
    </div>
  );
}

type EnrollmentState = {
  busy: boolean;
  code: string;
  error: string | null;
  errorId: string;
  finish: (event: FormEvent) => Promise<void>;
  password: string;
  saved: boolean;
  setCode: (code: string) => void;
  setPassword: (password: string) => void;
  setSaved: (saved: boolean) => void;
  setup: Setup | null;
  start: (event: FormEvent) => Promise<void>;
};

function useEnrollmentState(onEnrolled: () => Promise<boolean>): EnrollmentState {
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const start = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    await startEnrollment({ password, setError, setPassword, setSetup });
    setBusy(false);
  };
  const finish = async (event: FormEvent) => {
    event.preventDefault();
    if (!saved) return;
    setBusy(true);
    setError(null);
    await finishEnrollment(code, onEnrolled, setError);
    setBusy(false);
  };
  return { busy, code, error, errorId, finish, password, saved, setCode, setPassword, setSaved, setup, start };
}

type StartEnrollmentOptions = {
  password: string;
  setError: (error: string) => void;
  setPassword: (password: string) => void;
  setSetup: (setup: Setup) => void;
};

async function startEnrollment({ password, setError, setPassword, setSetup }: StartEnrollmentOptions) {
  try {
    const result = await authClient.twoFactor.enable({ ...(password ? { password } : {}), issuer: APP_NAME });
    if (result.error) return setError(result.error.message ?? m.mfa_enrollment_start_failed());
    const decoded = parseMfaSetup(result.data);
    if (!decoded) return setError(m.mfa_enrollment_invalid_response());
    setSetup(decoded);
    setPassword("");
  } catch (cause) {
    console.error("MfaEnrollmentScreen: enrollment start failed", cause);
    setError(m.auth_service_unreachable());
  }
}

async function finishEnrollment(code: string, onEnrolled: () => Promise<boolean>, setError: (error: string) => void) {
  try {
    const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    if (result.error) return setError(result.error.message ?? m.mfa_enrollment_code_rejected());
    if (!(await onEnrolled())) setError(m.mfa_enrollment_confirm_failed());
  } catch (cause) {
    console.error("MfaEnrollmentScreen: verification failed", cause);
    setError(m.auth_service_unreachable());
  }
}

function EnrollmentHeader({ blockedEntry }: { blockedEntry?: PublicAuthEntry }) {
  return (
    <CardHeader>
      <CardTitle>
        <h1>{m.mfa_enrollment_title()}</h1>
      </CardTitle>
      <CardDescription>
        {m.mfa_enrollment_description({ app: APP_NAME })}
        {blockedEntry === "password-reset" && (
          <span className="mt-2 block font-medium text-ink">{m.mfa_enrollment_password_reset_blocked()}</span>
        )}
        {blockedEntry === "invitation" && (
          <span className="mt-2 block font-medium text-ink">{m.mfa_enrollment_invitation_blocked()}</span>
        )}
      </CardDescription>
    </CardHeader>
  );
}

/** Mandatory pre-data enrollment wall for a password deployment that requires MFA. */
export function MfaEnrollmentScreen({
  onEnrolled,
  onSignOut,
  blockedEntry = null,
}: {
  onEnrolled: () => Promise<boolean>;
  onSignOut: () => void;
  blockedEntry?: PublicAuthEntry;
}) {
  const enrollment = useEnrollmentState(onEnrolled);

  // AuthProvider renders this mandatory wall instead of the router, so AppShell cannot set or
  // replace document.title while enrollment is required.
  useEffect(() => {
    document.title = `${m.mfa_enrollment_title()} · ${APP_NAME}`;
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <Card className="w-full max-w-lg">
        <EnrollmentHeader blockedEntry={blockedEntry} />
        <CardContent>
          {!enrollment.setup ? (
            <StartForm
              busy={enrollment.busy}
              error={enrollment.error}
              errorId={enrollment.errorId}
              onPasswordChange={enrollment.setPassword}
              onSignOut={onSignOut}
              onSubmit={(event) => void enrollment.start(event)}
              password={enrollment.password}
            />
          ) : (
            <VerificationForm
              busy={enrollment.busy}
              code={enrollment.code}
              error={enrollment.error}
              errorId={enrollment.errorId}
              onCodeChange={enrollment.setCode}
              onSavedChange={enrollment.setSaved}
              onSubmit={(event) => void enrollment.finish(event)}
              saved={enrollment.saved}
              setup={enrollment.setup}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
