import { m } from "@/i18n";
import { SwitchField, TextField, type ProductFieldLayout } from "./ui";
import type { PrivateNameFieldsState } from "./usePrivateNameFields";

export function PrivateNameFields({
  fields,
  errorField,
  errorId,
  layout = "stacked",
}: {
  fields: PrivateNameFieldsState;
  errorField: string | null;
  errorId: string;
  layout?: ProductFieldLayout;
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
        layout={layout}
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
            layout={layout}
          />
          <p className="text-xs text-muted-foreground">{m.form_private_code_name_hint()}</p>
        </>
      )}
    </>
  );
}
