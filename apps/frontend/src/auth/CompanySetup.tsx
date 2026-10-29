import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiRouteUrl } from '@/api/queryClient';
import { apiFetch } from '@/data/requestTimeout';
import { readApiError } from '@/lib/readApiError';
import {
  MAX_NAME_LENGTH,
  parseUserName,
  normalizeUserText,
  unicodeCharacterCount,
} from '@capacitylens/shared/lib/strings';
import {
  DEFAULT_TIME_ZONE,
  listSupportedTimeZones,
  resolveTimeZoneOptionLabel,
} from '@/lib/timezones';
import { m } from '@/i18n';

/** Collects the company name and fixed calendar convention after native identity authentication. */
export function CompanySetup({
  onCreated,
  onConflict,
  onSignOut,
}: {
  onCreated: () => Promise<void> | void;
  onConflict: () => Promise<boolean>;
  onSignOut: () => Promise<void> | void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(1);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy) return;
    const canonicalName = parseUserName(name);
    if (canonicalName === null) {
      setError(
        !name.trim()
          ? m.validation_name_required()
          : unicodeCharacterCount(normalizeUserText(name)) > MAX_NAME_LENGTH
            ? m.validation_text_too_long()
            : m.validation_text_invalid(),
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(apiRouteUrl('api.installation.company', {}), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: canonicalName, weekStartsOn, timeZone }),
      });
      if (response.status === 409 && (await onConflict())) return;
      if (!response.ok) throw new Error((await readApiError(response)) ?? m.company_setup_failed());
      await onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : m.company_setup_failed());
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-6" data-testid="company-setup">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 className="text-2xl font-semibold">{m.company_setup_title()}</h1>
        <p className="text-sm text-muted-foreground">{m.company_setup_intro()}</p>
        <div className="space-y-2">
          <Label htmlFor={id}>{m.company_setup_name_label()}</Label>
          <Input
            id={id}
            data-testid="company-setup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoComplete="organization"
            disabled={busy}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-week`}>{m.settings_week_start_label()}</Label>
          <select
            id={`${id}-week`}
            value={weekStartsOn}
            onChange={(event) => setWeekStartsOn(event.target.value === '0' ? 0 : 1)}
            disabled={busy}
            className="h-9 w-full rounded-md border bg-surface px-3 text-sm"
          >
            <option value="1">{m.settings_week_start_monday()}</option>
            <option value="0">{m.settings_week_start_sunday()}</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-zone`}>{m.settings_timezone_label()}</Label>
          <select
            id={`${id}-zone`}
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            disabled={busy}
            className="h-9 w-full rounded-md border bg-surface px-3 text-sm"
          >
            {listSupportedTimeZones().map((zone) => (
              <option key={zone} value={zone}>
                {resolveTimeZoneOptionLabel(zone)}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          data-testid="company-setup-submit"
          type="submit"
          disabled={busy || !name.trim()}
          className="w-full"
        >
          {busy ? m.company_setup_creating() : m.company_setup_create()}
        </Button>
        <Button
          type="button"
          variant="link"
          disabled={busy}
          onClick={() => void onSignOut()}
          className="w-full"
        >
          {m.company_setup_sign_out()}
        </Button>
      </form>
    </main>
  );
}
