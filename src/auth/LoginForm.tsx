import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { m } from "@/i18n";
import { MAX_PASSWORD_INPUT_CODE_UNITS, MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { LoginField } from "./LoginField";

type LoginIds = {
  name: string;
  email: string;
  password: string;
  setupToken: string;
  setupTokenHelp: string;
  error: string;
};

type LoginFormProps = {
  authMode: "password-only" | "sso-only" | "password-and-sso";
  setup: boolean;
  microsoftBootstrap?: boolean;
  passwordAutoFocus: boolean;
  busy: boolean;
  error: string | null;
  ids: LoginIds;
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
  if (allowsPasswordSignIn(props.authMode)) {
    return (
      <PasswordForm
        autoFocus={props.passwordAutoFocus}
        busy={props.busy}
        error={props.error}
        ids={props.ids}
        passwordSignIn={props.passwordSignIn}
      />
    );
  }
  if (props.microsoftBootstrap) {
    return (
      <MicrosoftBootstrapEmail
        ids={props.ids}
        passwordSignIn={props.passwordSignIn}
        busy={props.busy}
        error={props.error}
      />
    );
  }
  return null;
}

function MicrosoftBootstrapEmail({
  ids,
  passwordSignIn,
  busy,
  error,
}: Pick<LoginFormProps, "ids" | "passwordSignIn" | "busy" | "error">) {
  return (
    <LoginField
      id={ids.email}
      label={m.login_setup_email()}
      type="email"
      autoComplete="email"
      value={passwordSignIn.email}
      onChange={(event) => passwordSignIn.setEmail(event.target.value)}
      disabled={busy}
      aria-invalid={Boolean(error)}
      aria-describedby={error ? ids.error : undefined}
      autoFocus
    />
  );
}

type OwnerSetupFormProps = Pick<LoginFormProps, "busy" | "error" | "ids" | "ownerSetup" | "passwordSignIn">;

function OwnerSetupForm({ busy, error, ids, ownerSetup, passwordSignIn }: OwnerSetupFormProps) {
  const setupTokenTooLong = ownerSetup.setupToken.length > 512;
  return (
    <form
      onSubmit={(event) => {
        if (setupTokenTooLong) {
          event.preventDefault();
          return;
        }
        void ownerSetup.createOwner(event);
      }}
      noValidate
    >
      <FieldGroup className="gap-3">
        <OwnerSetupFields
          error={error}
          ids={ids}
          ownerSetup={ownerSetup}
          passwordSignIn={passwordSignIn}
          setupTokenTooLong={setupTokenTooLong}
        />
        <FieldError id={ids.error}>{setupTokenTooLong ? m.login_setup_token_invalid() : error}</FieldError>
        <div className="flex justify-end">
          <Button size="sm" type="submit" data-testid="owner-setup-submit" disabled={busy}>
            {m.login_create_owner()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}

type OwnerSetupFieldsProps = Pick<LoginFormProps, "error" | "ids" | "ownerSetup" | "passwordSignIn"> & {
  setupTokenTooLong: boolean;
};

function OwnerSetupFields({ error, ids, ownerSetup, passwordSignIn, setupTokenTooLong }: OwnerSetupFieldsProps) {
  const describedBy = error || setupTokenTooLong ? ids.error : undefined;
  return (
    <>
      <LoginField
        id={ids.name}
        label={m.login_name()}
        data-testid="owner-setup-name"
        type="text"
        autoComplete="name"
        value={ownerSetup.name}
        onChange={(event) => ownerSetup.setName(event.target.value)}
        aria-describedby={describedBy}
        autoFocus
      />
      <LoginField
        id={ids.email}
        label={m.login_setup_email()}
        data-testid="owner-setup-email"
        type="email"
        autoComplete="email"
        value={passwordSignIn.email}
        onChange={(event) => passwordSignIn.setEmail(event.target.value)}
        aria-describedby={describedBy}
      />
      <LoginField
        id={ids.password}
        label={m.login_setup_password()}
        data-testid="owner-setup-password"
        type="password"
        autoComplete="new-password"
        value={passwordSignIn.password}
        minLength={MIN_PASSWORD_LENGTH}
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
        aria-invalid={setupTokenTooLong || undefined}
        aria-describedby={[ids.setupTokenHelp, describedBy].filter(Boolean).join(" ")}
      />
      <p id={ids.setupTokenHelp} className="text-xs text-muted-foreground">
        {m.login_setup_token_help()}
      </p>
    </>
  );
}

type PasswordFormProps = Pick<LoginFormProps, "busy" | "error" | "ids" | "passwordSignIn"> & {
  autoFocus: boolean;
};

function PasswordForm({ autoFocus, busy, error, ids, passwordSignIn }: PasswordFormProps) {
  const [passwordTooLong, setPasswordTooLong] = useState(false);
  const describedBy = error ? ids.error : undefined;
  return (
    <form
      onSubmit={(event) => {
        if (passwordSignIn.password.length > MAX_PASSWORD_INPUT_CODE_UNITS) {
          event.preventDefault();
          setPasswordTooLong(true);
          return;
        }
        setPasswordTooLong(false);
        void passwordSignIn.signInWithPassword(event);
      }}
      noValidate
    >
      <FieldGroup className="gap-3">
        <LoginField
          id={ids.email}
          label={m.login_email()}
          type="email"
          autoComplete="email"
          value={passwordSignIn.email}
          onChange={(event) => passwordSignIn.setEmail(event.target.value)}
          aria-describedby={describedBy}
          autoFocus={autoFocus}
        />
        <LoginField
          id={ids.password}
          label={m.login_password()}
          type="password"
          autoComplete="current-password"
          value={passwordSignIn.password}
          onChange={(event) => passwordSignIn.setPassword(event.target.value)}
          aria-invalid={passwordTooLong || undefined}
          aria-describedby={passwordTooLong || error ? ids.error : undefined}
        />
        <FieldError id={ids.error}>{passwordTooLong ? m.login_password_input_too_long() : error}</FieldError>
        <div className="flex justify-end">
          <Button size="sm" type="submit" disabled={busy}>
            {m.login_sign_in()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
