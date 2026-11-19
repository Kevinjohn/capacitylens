import { useState } from 'react';
import type { Route } from '@capacitylens/backend/registry';
import { apiRouteUrl, buildJsonBody } from '@/api/queryClient';
import { apiFetch } from '@/data/requestTimeout';
import { readApiError } from '@/lib/readApiError';
import { Modal } from '@/components/common/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { m } from '@/i18n';

type ConfirmationBody = Route.Body<'api.auth.password-confirmation'>;

/** One action with its own intent shape, as the generated request body pairs them. */
export type PasswordConfirmationRequest = ConfirmationBody extends infer Body
  ? Body extends { action: unknown; intent: unknown }
    ? Pick<Body, 'action' | 'intent'>
    : never
  : never;

type PasswordConfirmationDialogProps = PasswordConfirmationRequest & {
  companyId: string;
  onConfirmed: (confirmationId: string) => void;
  onCancel: () => void;
};

/** Confirms one exact action; each dialog receives only its own confirmation id. */
export function PasswordConfirmationDialog({
  companyId,
  onConfirmed,
  onCancel,
  ...request
}: PasswordConfirmationDialogProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const url = apiRouteUrl('api.auth.password-confirmation', {});
      const response = await apiFetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: buildJsonBody('api.auth.password-confirmation', { ...request, companyId, password }),
      });
      if (!response.ok) {
        setError((await readApiError(response)) ?? m.reauth_failed());
        setBusy(false);
        return;
      }
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('confirmationId' in result) ||
        typeof result.confirmationId !== 'string'
      ) {
        throw new Error('Password confirmation returned no confirmation id.');
      }
      onConfirmed(result.confirmationId);
    } catch (cause) {
      console.error('Password confirmation failed', cause);
      setError(m.login_network_error());
      setBusy(false);
    }
  };

  return (
    <Modal
      title={m.reauth_title()}
      description={m.password_confirmation_body()}
      onClose={busy ? () => {} : onCancel}
      onSubmit={() => void confirm()}
      guardDirty={false}
      footer={
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {m.form_cancel()}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor="password-confirmation-input">{m.login_password()}</FieldLabel>
          <Input
            id="password-confirmation-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={busy || !password}
          data-testid="password-confirmation-submit"
        >
          {busy ? m.reauth_confirming() : m.common_continue()}
        </Button>
      </div>
    </Modal>
  );
}
