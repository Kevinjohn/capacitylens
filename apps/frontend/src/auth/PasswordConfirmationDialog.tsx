import { useState } from 'react';
import { apiRouteUrl } from '@/api/queryClient';
import { apiFetch } from '@/data/requestTimeout';
import { readApiError } from '@/lib/readApiError';
import { Modal } from '@/components/common/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { m } from '@/i18n';

type Action = 'transfer-ownership' | 'import' | 'anonymise';

interface PasswordConfirmationDialogProps {
  action: Action;
  accountId: string;
  intent: object;
  onConfirmed: (confirmationId: string) => void;
  onCancel: () => void;
}

/** Confirms one exact action; each dialog receives only its own confirmation id. */
export function PasswordConfirmationDialog({
  action,
  accountId,
  intent,
  onConfirmed,
  onCancel,
}: PasswordConfirmationDialogProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = apiRouteUrl('api.auth.password-confirmation', {});
      const body = { action, accountId, intent, password };
      const response = await apiFetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
          type="button"
          disabled={busy || !password}
          onClick={() => void confirm()}
          data-testid="password-confirmation-submit"
        >
          {busy ? m.ownership_transfer_working() : m.common_continue()}
        </Button>
      </div>
    </Modal>
  );
}
