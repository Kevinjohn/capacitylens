import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { APP_NAME } from '@capacitylens/shared/brand';
import { isRole } from '@capacitylens/shared/account/types';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  getPasswordLengthFailure,
} from '@capacitylens/shared/domain/password';
import { m } from '@/i18n';
import { readInvitationPreview, signUpWithInvitation } from '@/account/invitationSignupApi';
import type { InvitationPreview } from '@/account/invitationSignupApi';
import { resolveRoleLabel } from '@/lib/accessCopy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';

// The invitation route renders before sign-in. The server owns the token, fixes the address and
// grants membership; an Owner or Admin still approves the new identity before it sees company data.

type State =
  | { kind: 'checking' }
  | { kind: 'form'; preview: InvitationPreview }
  | { kind: 'working'; preview: InvitationPreview }
  | { kind: 'failed'; message: string }
  /** The sign-up answer was lost or failed after the account may have been created. */
  | { kind: 'uncertain' };

/** Before the company exists an invitation is the setup link, and setup grants Owner. */
function getRoleText(role: string | null) {
  return role && isRole(role) ? resolveRoleLabel(role) : m.invite_setup_role();
}

function describeSignupError(name: string, password: string): string | null {
  if (!name.trim()) return m.invite_err_name_required();
  const lengthFailure = getPasswordLengthFailure(password);
  if (lengthFailure === 'too-short') return m.reset_err_short({ min: MIN_PASSWORD_LENGTH });
  if (lengthFailure === 'too-long') return m.reset_err_long({ max: MAX_PASSWORD_LENGTH });
  return null;
}

/** Accepts an emailed invitation by creating a password identity for its address, then signs in. */
export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  // React Router may keep this element while only `:token` changes; never carry state across links.
  return <InviteAcceptForToken key={token ?? ''} token={token} />;
}

function buildInitialState(token: string | undefined): State {
  return token ? { kind: 'checking' } : { kind: 'failed', message: m.invite_err_missing_token() };
}

function useInvitePreview(token: string | undefined) {
  const [state, setState] = useState<State>(() => buildInitialState(token));
  useEffect(() => {
    if (!token) return;
    let current = true;
    readInvitationPreview(token)
      .then((result) => {
        if (!current) return;
        setState(
          result.kind === 'ok'
            ? { kind: 'form', preview: result.preview }
            : {
                kind: 'failed',
                message:
                  result.kind === 'invalid' ? m.invite_err_invalid() : m.invite_err_unavailable(),
              },
        );
      })
      .catch((failure: unknown) => {
        console.warn('InviteAccept: preview failed', failure);
        if (current) setState({ kind: 'failed', message: m.invite_err_network() });
      });
    return () => {
      current = false;
    };
  }, [token]);
  return [state, setState] as const;
}

function InviteAcceptForToken({ token }: { token: string | undefined }) {
  const [state, setState] = useInvitePreview(token);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    document.title = `${m.invite_title()} · ${APP_NAME}`;
  }, []);

  const submit = async (event: FormEvent, preview: InvitationPreview) => {
    event.preventDefault();
    if (!token) return;
    const invalid = describeSignupError(name, password);
    setError(invalid);
    if (invalid) return;
    setState({ kind: 'working', preview });
    try {
      const result = await signUpWithInvitation(token, { name: name.trim(), password });
      if (result.kind === 'signed-up') {
        // A full reload rechecks the session; after a 202 the account exists and sign-in shows.
        window.location.assign('/');
        return;
      }
      if (result.kind === 'uncertain') {
        setPassword('');
        setState({ kind: 'uncertain' });
        return;
      }
      if (result.kind === 'invalid-token') {
        setState({ kind: 'failed', message: m.invite_err_invalid() });
        return;
      }
      setError(
        result.kind === 'email-in-use'
          ? m.invite_err_email_registered()
          : (result.message ?? m.invite_err_failed()),
      );
      setState({ kind: 'form', preview });
    } catch (failure) {
      // The account may exist; a retry would spend nothing useful and report a misleading invalid link.
      console.error('InviteAccept: sign-up failed', failure);
      setPassword('');
      setState({ kind: 'uncertain' });
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">{m.invite_title()}</h1>
        </div>
        <Card className="gap-4 py-4">
          <CardContent className="flex flex-col gap-3 px-4">
            {state.kind === 'checking' && (
              <p role="status" className="text-sm text-muted-foreground">
                {m.invite_checking()}
              </p>
            )}
            {state.kind === 'uncertain' && (
              <>
                <p role="alert" data-testid="invite-uncertain" className="text-sm">
                  {m.invite_uncertain()}
                </p>
                <div className="flex justify-end">
                  <Button asChild size="sm">
                    <a href="/">{m.invite_go_to_app()}</a>
                  </Button>
                </div>
              </>
            )}
            {state.kind === 'failed' && (
              <>
                <p role="alert" data-testid="invite-error" className="text-sm">
                  {state.message}
                </p>
                <div className="flex justify-end">
                  <Button asChild size="sm" variant="outline">
                    <a href="/">{m.invite_go_to_app()}</a>
                  </Button>
                </div>
              </>
            )}
            {(state.kind === 'form' || state.kind === 'working') && (
              <form onSubmit={(event) => void submit(event, state.preview)} noValidate>
                <FieldGroup className="gap-3">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    {state.preview.companyName && (
                      <>
                        <dt className="text-muted-foreground">{m.invite_company_label()}</dt>
                        <dd data-testid="invite-company">{state.preview.companyName}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">{m.invite_proposed_role_label()}</dt>
                    <dd data-testid="invite-role">{getRoleText(state.preview.role)}</dd>
                  </dl>
                  <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {m.invite_sign_up_intro({ email: state.preview.email })}
                  </p>
                  <Field>
                    <FieldLabel htmlFor={nameId}>{m.invite_name()}</FieldLabel>
                    <Input
                      id={nameId}
                      data-testid="invite-name"
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      aria-describedby={error ? errorId : undefined}
                      autoFocus
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={passwordId}>{m.invite_password()}</FieldLabel>
                    <Input
                      id={passwordId}
                      data-testid="invite-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      aria-describedby={error ? errorId : undefined}
                    />
                  </Field>
                  <FieldError id={errorId}>{error}</FieldError>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      type="submit"
                      data-testid="invite-submit"
                      disabled={state.kind === 'working'}
                    >
                      {m.invite_sign_up_submit()}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
