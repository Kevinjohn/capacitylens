import { m } from '@/i18n';
import { MAX_PASSWORD_INPUT_CODE_UNITS } from '@capacitylens/shared/domain/password';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, FieldGroup } from '@/components/ui/field';
import { SignInField } from './SignInField';

type SignInIds = {
  email: string;
  password: string;
  error: string;
};

type SignInFormProps = {
  passwordAutoFocus: boolean;
  busy: boolean;
  error: string | null;
  ids: SignInIds;
  passwordSignIn: {
    email: string;
    setEmail: Dispatch<SetStateAction<string>>;
    password: string;
    setPassword: Dispatch<SetStateAction<string>>;
    signInWithPassword: (event: FormEvent) => Promise<void>;
  };
};

/** The password sign-in form. */
export function SignInForm(props: SignInFormProps) {
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

type PasswordFormProps = Pick<SignInFormProps, 'busy' | 'error' | 'ids' | 'passwordSignIn'> & {
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
        <SignInField
          id={ids.email}
          label={m.sign_in_email()}
          type="email"
          autoComplete="email"
          value={passwordSignIn.email}
          onChange={(event) => passwordSignIn.setEmail(event.target.value)}
          aria-describedby={describedBy}
          autoFocus={autoFocus}
        />
        <SignInField
          id={ids.password}
          label={m.sign_in_password()}
          type="password"
          autoComplete="current-password"
          value={passwordSignIn.password}
          onChange={(event) => passwordSignIn.setPassword(event.target.value)}
          aria-invalid={passwordTooLong || undefined}
          aria-describedby={passwordTooLong || error ? ids.error : undefined}
        />
        <FieldError id={ids.error}>
          {passwordTooLong ? m.sign_in_password_input_too_long() : error}
        </FieldError>
        <div className="flex justify-end">
          <Button size="sm" type="submit" disabled={busy}>
            {m.sign_in_button()}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
