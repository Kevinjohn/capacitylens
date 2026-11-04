import { useId } from 'react';
import { m } from '@/i18n';
import { SegmentedControl, TextField } from '@/components/common/ui';
import type { Option, SegmentedOption } from '@/components/common/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { TimeZoneField } from './TimeZoneField';

/** The new-company form, shown while creating or when an empty installation can set up its first company. */
export function AccountCreationPanel({
  form,
  companySetupEligible,
  onSubmit,
  onCancel,
}: {
  form: CreateAccountFormState & { creating: boolean };
  companySetupEligible: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!form.creating && !companySetupEligible) return null;
  const props = buildCreateAccountPanelProps(
    form,
    onSubmit,
    companySetupEligible ? undefined : onCancel,
  );
  return <CreateAccountPanel {...props} />;
}

interface CreateAccountPanelProps {
  showHeading: boolean;
  name: string;
  language: string;
  weekStartsOn: 0 | 1;
  timezone: string;
  error: string | null;
  errorField: string | null;
  errorId: string;
  timeZoneSelectOptions: Option[];
  weekStartSelectOptions: SegmentedOption<0 | 1>[];
  onNameChange: (name: string) => void;
  onWeekStartChange: (weekStartsOn: 0 | 1) => void;
  onTimeZoneChange: (timezone: string) => void;
  onClearError: () => void;
  onSubmit: () => void;
  onCancel?: () => void;
}

interface CreateAccountFormState {
  name: string;
  language: string;
  setName: (name: string) => void;
  weekStartsOn: 0 | 1;
  setWeekStartsOn: (weekStartsOn: 0 | 1) => void;
  timezone: string;
  setTimezone: (timezone: string) => void;
  error: string | null;
  errorField: string | null;
  errorId: string;
  clear: () => void;
  timeZoneSelectOptions: Option[];
  weekStartSelectOptions: SegmentedOption<0 | 1>[];
}

function buildCreateAccountPanelProps(
  form: CreateAccountFormState,
  onSubmit: () => void,
  onCancel?: () => void,
): CreateAccountPanelProps {
  return {
    showHeading: onCancel !== undefined,
    name: form.name,
    language: form.language,
    weekStartsOn: form.weekStartsOn,
    timezone: form.timezone,
    error: form.error,
    errorField: form.errorField,
    errorId: form.errorId,
    timeZoneSelectOptions: form.timeZoneSelectOptions,
    weekStartSelectOptions: form.weekStartSelectOptions,
    onNameChange: form.setName,
    onWeekStartChange: form.setWeekStartsOn,
    onTimeZoneChange: form.setTimezone,
    onClearError: form.clear,
    onSubmit,
    ...(onCancel ? { onCancel } : {}),
  };
}

function AccountLanguageDisplay({ value }: { value: string }) {
  const labelId = useId();
  const selectId = useId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <label htmlFor={selectId} id={labelId} className="mb-1.5 block text-xs font-medium text-ink">
        {m.picker_language()}
      </label>
      <select
        id={selectId}
        value={value}
        disabled
        data-testid="create-language"
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-(--input-background) px-3 py-2 text-sm text-ink shadow-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value={value}>{m.picker_language_english()}</option>
      </select>
    </div>
  );
}

function CreateAccountPanel(input: CreateAccountPanelProps) {
  const changeName = (name: string) => {
    input.onNameChange(name);
    if (input.errorField === 'name') input.onClearError();
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        input.onSubmit();
      }}
      className="mt-4"
    >
      <Card>
        {input.showHeading && (
          <CardHeader>
            <CardTitle>
              <h2>{m.picker_new()}</h2>
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className="flex flex-col gap-3">
          <TextField
            label={m.picker_company_name()}
            value={input.name}
            onChange={changeName}
            autoFocus
            invalid={input.errorField === 'name'}
            describedById={input.errorId}
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">{m.picker_fixed_settings_group()}</legend>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink">{m.picker_week_start()}</p>
              <SegmentedControl
                variant="recessed"
                ariaLabel={m.picker_week_start()}
                value={input.weekStartsOn}
                onChange={input.onWeekStartChange}
                options={input.weekStartSelectOptions}
                fullWidth
              />
            </div>
            <TimeZoneField
              label={m.picker_timezone()}
              value={input.timezone}
              onChange={input.onTimeZoneChange}
              options={input.timeZoneSelectOptions}
            />
            <AccountLanguageDisplay value={input.language} />
          </fieldset>
          <FieldError id={input.errorId}>{input.error}</FieldError>
        </CardContent>
        <CardFooter className="flex-col gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
          {input.onCancel && (
            <Button size="sm" type="button" variant="outline" onClick={input.onCancel}>
              {m.picker_cancel()}
            </Button>
          )}
          <Button size="sm" type="submit">
            {m.picker_create()}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
