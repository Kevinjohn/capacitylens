import { PlanningSaveCancelledError } from "@/data/planning/PlanningSaveCancelledError";
import { useState } from "react";
import { useStore } from "@/store/useStore";
import { useFieldError } from "@/hooks/useFieldError";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { validatePresetColor, parseName } from "@/lib/validation";
import { isStaleEdit } from "@/lib/isStaleEdit";
import { m } from "@/i18n";
import { ColorField, FormActions, Modal, RequiredLegend, TextField } from "@/components/common/ui";
import { PrivateNameFields } from "@/components/common/PrivateNameFields";
import { usePrivateNameFields } from "@/components/common/usePrivateNameFields";
import { FieldError } from "@/components/ui/field";
import { DEFAULT_COLORS } from "@/lib/palette";
import type { Client } from "@capacitylens/shared/types/entities";

function ClientFormFields({
  name,
  onNameChange,
  privateNameFields,
  color,
  onColorChange,
  errorField,
  errorId,
  error,
}: {
  name: string;
  onNameChange: (value: string) => void;
  privateNameFields: ReturnType<typeof usePrivateNameFields>;
  color: string;
  onColorChange: (value: string) => void;
  errorField: string | null;
  errorId: string;
  error: string | null;
}) {
  return (
    <>
      <TextField
        label={m.form_client_name_label()}
        value={name}
        onChange={onNameChange}
        autoFocus={!privateNameFields.protectedName}
        required
        disabled={privateNameFields.protectedName}
        invalid={errorField === "name"}
        describedById={errorId}
        layout="label-control"
      />
      <PrivateNameFields fields={privateNameFields} errorField={errorField} errorId={errorId} layout="label-control" />
      <ColorField
        label={m.form_client_colour_label()}
        value={color}
        onChange={onColorChange}
        invalid={errorField === "color"}
        describedById={errorId}
        layout="label-control"
      />
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </>
  );
}

/** Add (no `client`) or edit a client: name + preset colour. `onClose` fires on save or cancel. */
export function ClientForm({ client, onClose }: { client?: Client; onClose: () => void }) {
  const addClient = useStore((state) => state.addClient);
  const updateClient = useStore((state) => state.updateClient);
  const [name, setName] = useState(client?.name ?? "");
  const [color, setColor] = useState(client?.color ?? DEFAULT_COLORS.client);
  const { error, errorField, errorId, fail } = useFieldError();
  const privateNameFields = usePrivateNameFields(client, fail);

  const submit = async () => {
    const trimmed = parseName(name, fail);
    if (!trimmed) return;
    const privacy = privateNameFields.parsePrivacyPatch();
    if (!privacy) return;
    if (!validatePresetColor(color, fail)) return;
    // Surface store integrity rejections as form errors so they remain visible instead of escaping the React event handler.
    try {
      if (client) {
        if (isStaleEdit(useStore.getState().data.clients, client.id, client.updatedAt)) {
          fail(null, m.form_client_err_changed());
          return;
        }
        await updateClient(client.id, { name: trimmed, color, ...privacy });
      } else {
        const result = await addClient({
          name: trimmed,
          color,
          ...(privacy.isPrivate && privacy.codeName
            ? { isPrivate: privacy.isPrivate, codeName: privacy.codeName }
            : {}),
        });
        if (result.kind === "blocked") return;
      }
      onClose();
    } catch (e) {
      if (e instanceof PlanningSaveCancelledError) return;
      fail(null, resolveErrorMessage(e));
    }
  };

  return (
    <Modal
      title={client ? m.form_client_edit_title() : m.form_client_add_title()}
      onClose={onClose}
      onSubmit={() => {
        void submit();
      }}
      footer={<FormActions onCancel={onClose} />}
    >
      <ClientFormFields
        name={name}
        onNameChange={setName}
        privateNameFields={privateNameFields}
        color={color}
        onColorChange={setColor}
        errorField={errorField}
        errorId={errorId}
        error={error}
      />
    </Modal>
  );
}
