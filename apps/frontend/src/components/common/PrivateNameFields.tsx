import { m } from '@/i18n';
import { SwitchField, TextField } from './ui';
import type { ProductFieldLayout } from './ui';
import type { PrivateNameFieldsState } from './usePrivateNameFields';

/** Edits private name fields only when the current role may view them. */
export function PrivateNameFields({
  fields,
  errorField,
  errorId,
  layout = 'stacked',
  disabled = false,
}: {
  fields: PrivateNameFieldsState;
  errorField: string | null;
  errorId: string;
  layout?: ProductFieldLayout;
  disabled?: boolean;
}) {
  if (!fields.canManagePrivacy) {
    return fields.protectedName ? (
      <p className="text-xs text-muted-foreground">{m.form_private_owner_only_hint()}</p>
    ) : null;
  }

  return (
    <>
      <SwitchField
        label={m.form_private_toggle_label()}
        checked={fields.isPrivate}
        onChange={fields.setIsPrivate}
        disabled={disabled}
        layout={layout}
      />
      {fields.isPrivate && (
        <TextField
          label={m.form_private_code_name_label()}
          value={fields.codeName}
          onChange={fields.setCodeName}
          disabled={disabled}
          placeholder={m.form_private_code_name_placeholder()}
          description={m.form_private_code_name_hint()}
          required
          invalid={errorField === 'codeName'}
          describedById={errorId}
          layout={layout}
        />
      )}
    </>
  );
}
