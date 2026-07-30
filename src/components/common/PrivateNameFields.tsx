import { m } from "@/i18n";
import { SwitchField, TextField } from "./ui";
import type { PrivateNameFieldsState } from "./usePrivateNameFields";

export function PrivateNameFields({
  fields,
  errorField,
  errorId,
}: {
  fields: PrivateNameFieldsState;
  errorField: string | null;
  errorId: string;
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
        description={m.form_private_toggle_description()}
        checked={fields.isPrivate}
        onChange={fields.setIsPrivate}
      />
      {fields.isPrivate && (
        <>
          <TextField
            label={m.form_private_code_name_label()}
            value={fields.codeName}
            onChange={fields.setCodeName}
            placeholder={m.form_private_code_name_placeholder()}
            required
            invalid={errorField === "codeName"}
            describedById={errorId}
          />
          <p className="text-xs text-muted-foreground">{m.form_private_code_name_hint()}</p>
        </>
      )}
    </>
  );
}
