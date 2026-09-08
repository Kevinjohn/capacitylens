import { m } from "@/i18n";
import { MAX_PASSWORD_INPUT_CODE_UNITS, MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { MAX_EMAIL_LENGTH, MAX_NAME_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Button } from "../components/ui/button";
import { FieldError, FieldGroup } from "../components/ui/field";
import { LoginField } from "./LoginField";

type LoginIds = { name: string; email: string; password: string; setupToken: string; error: string };

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
    verifySecondFactor: (event: FormEvent) => Promise<void>;
  };
  passwordSignIn: {
    email: string;
    setEmail: Dispatch<SetStateAction<string>>;
    password: string;
    setPassword: Dispatch<SetStateAction<string>>;
    signInWithPassword: (event: FormEvent) => Promise<void>;
  };
  ownerSetup: {
    name: string;
    setName: Dispatch<SetStateAction<string>>;
    setupToken: string;
    setSetupToken: Dispatch<SetStateAction<string>>;
    createOwner: (event: FormEvent) => Promise<void>;
  };
};

export function LoginForm(props: LoginFormProps) {
  if (props.secondFactor.twoFactorPending) {
    return (
      <SecondFactorForm
        busy={props.busy}
        error={props.error}
        setError={props.setError}
        errorId={props.ids.error}
        secondFactor={props.secondFactor}
      />
    );
  }
  if (props.setup) {
    return (
      <OwnerSetupForm
        busy={props.busy}
        error={props.error}
        ids={props.ids}
        ownerSetup={props.ownerSetup}
        passwordSignIn={props.passwordSignIn}
      />
    );
  }
  if (props.authMode === "password") {
    return <PasswordForm busy={props.busy} error={props.error} ids={props.ids} passwordSignIn={props.passwordSignIn} />;
  }
  return null;
}

type SecondFactorFormProps = Pick<LoginFormProps, "busy" | "error" | "setError"> & {
  errorId: string;
  secondFactor: LoginFormProps["secondFactor"];
};

function SecondFactorForm({ busy, error, setError, errorId, secondFactor }: SecondFactorFormProps) {
  const { twoFactorCode, setTwoFactorCode, useRecoveryCode, setUseRecoveryCode, verifySecondFactor } = secondFactor;
  const prompt = useRecoveryCode ? m.login_mfa_recovery_prompt() : m.login_mfa_authenticator_prompt();
  const label = useRecoveryCode ? m.login_mfa_recovery_code() : m.login_mfa_authentication_code();
  const toggleLabel = useRecoveryCode ? m.login_mfa_use_authenticator() : m.login_mfa_use_recovery();
  const toggleCodeKind = () => {
    setUseRecoveryCode((value) => !value);
    setTwoFactorCode("");
    setError(null);
  };
  return (
    <form onSubmit={(event) => void verifySecondFactor(event)} noValidate>
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
          onChange={(event) => setTwoFactorCode(event.target.value.trim())}
          aria-describedby={error ? errorId : undefined}
          autoFocus
        />
        <FieldError id={errorId}>{error}</FieldError>
        <div className="flex items-center justify-between gap-3">
          <Button size="sm" type="button" variant="outline" onClick={toggleCodeKind}>
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

type OwnerSetupFormProps = Pick<LoginFormProps, "busy" | "error" | "ids" | "ownerSetup" | "passwordSignIn">;

function OwnerSetupForm({ busy, error, ids, ownerSetup, passwordSignIn }: OwnerSetupFormProps) {
  return (
    <form onSubmit={(event) => void ownerSetup.createOwner(event)} noValidate>
      <FieldGroup className="gap-3">
        <OwnerSetupFields error={error} ids={ids} ownerSetup={ownerSetup} passwordSignIn={passwordSignIn} />
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

type OwnerSetupFieldsProps = Pick<LoginFormProps, "error" | "ids" | "ownerSetup" | "passwordSignIn">;

function OwnerSetupFields({ error, ids, ownerSetup, passwordSignIn }: OwnerSetupFieldsProps) {
  const describedBy = error ? ids.error : undefined;
  return (
    <>
      <LoginField
        id={ids.name}
        label={m.login_name()}
        data-testid="owner-setup-name"
        type="text"
        autoComplete="name"
        value={ownerSetup.name}
        maxLength={MAX_NAME_INPUT_CODE_UNITS}
        onChange={(event) => ownerSetup.setName(event.target.value)}
        aria-describedby={describedBy}
        autoFocus
      />
      <LoginField
        id={ids.email}
        label={m.login_email()}
        data-testid="owner-setup-email"
        type="email"
        autoComplete="email"
        value={passwordSignIn.email}
        maxLength={MAX_EMAIL_LENGTH}
        onChange={(event) => passwordSignIn.setEmail(event.target.value)}
        aria-describedby={describedBy}
      />
      <LoginField
        id={ids.password}
        label={m.login_password()}
        data-testid="owner-setup-password"
        type="password"
        autoComplete="new-password"
        value={passwordSignIn.password}
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
        onChange={(event) => passwordSignIn.setPassword(event.target.value)}
        aria-describedby={describedBy}
      />
      <LoginField
        id={ids.setupToken}
        label={m.login_setup_token()}
        data-testid="owner-setup-token"
        type="password"
        autoComplete="off"
        value={ownerSetup.setupToken}
        onChange={(event) => ownerSetup.setSetupToken(event.target.value)}
        placeholder={m.login_setup_token_placeholder()}
        aria-describedby={describedBy}
      />
    </>
  );
}

type PasswordFormProps = Pick<LoginFormProps, "busy" | "error" | "ids" | "passwordSignIn">;

function PasswordForm({ busy, error, ids, passwordSignIn }: PasswordFormProps) {
  const describedBy = error ? ids.error : undefined;
  return (
    <form onSubmit={(event) => void passwordSignIn.signInWithPassword(event)} noValidate>
      <FieldGroup className="gap-3">
        <LoginField
          id={ids.email}
          label={m.login_email()}
          type="email"
          autoComplete="email"
          value={passwordSignIn.email}
          maxLength={MAX_EMAIL_LENGTH}
          onChange={(event) => passwordSignIn.setEmail(event.target.value)}
          aria-describedby={describedBy}
          autoFocus
        />
        <LoginField
          id={ids.password}
          label={m.login_password()}
          type="password"
          autoComplete="current-password"
          value={passwordSignIn.password}
          maxLength={MAX_PASSWORD_INPUT_CODE_UNITS}
          onChange={(event) => passwordSignIn.setPassword(event.target.value)}
          aria-describedby={describedBy}
        />
        <FieldError id={ids.error}>{error}</FieldError>
        <div className="flex justify-end">
          <Button size="sm" type="submit" disabled={busy}>
            {m.login_sign_in()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
