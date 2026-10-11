import { useState } from "react";
import { useStore } from "@/store/useStore";
import { useFieldError } from "@/hooks/useFieldError";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { parseText } from "@/lib/validation";
import { isStaleEdit } from "@/lib/isStaleEdit";
import { m } from "@/i18n";
import { FormActions, Modal, RequiredLegend, TextField } from "@/components/common/ui";
import { FieldError } from "@/components/ui/field";
import { NEUTRAL_COLOR } from "@/lib/palette";
import { externalCapacityDefaults } from "@capacitylens/shared/types/entities";
import type { Resource } from "@capacitylens/shared/types/entities";

type ExternalFormFieldsProps = {
  name: string;
  onNameChange: (value: string) => void;
  role: string;
  onRoleChange: (value: string) => void;
  error: string | null;
  errorField: string | null;
  errorId: string;
};

function ExternalFormFields(props: ExternalFormFieldsProps) {
  return (
    <>
      <TextField
        label={m.form_external_company_label()}
        value={props.name}
        onChange={props.onNameChange}
        required
        invalid={props.errorField === "name"}
        describedById={props.errorId}
        layout="label-control"
      />
      <TextField
        label={m.form_external_descriptor_label()}
        value={props.role}
        onChange={props.onRoleChange}
        placeholder={m.form_external_descriptor_placeholder()}
        invalid={props.errorField === "role"}
        describedById={props.errorId}
        layout="label-control"
      />
      <FieldError id={props.errorId}>{props.error}</FieldError>
      <RequiredLegend />
    </>
  );
}

/** Creates or edits an external company and optional descriptor. Externals have no capacity; neutral colour and inert capacity defaults preserve the Resource entity contract. */
export function ExternalForm({ resource, onClose }: { resource?: Resource; onClose: () => void }) {
  const add = useStore((state) => state.addResource);
  const update = useStore((state) => state.updateResource);
  const [name, setName] = useState(resource?.name ?? "");
  const [role, setRole] = useState(resource?.role ?? "");
  const { error, errorField, errorId, fail } = useFieldError();

  const submit = () => {
    const cleanName = parseText(name, fail, {
      field: "name",
      required: true,
      requiredMessage: m.form_external_err_company_required(),
    });
    if (cleanName === null) return;
    const cleanRole = parseText(role, fail, { field: "role", required: false });
    if (cleanRole === null) return;
    const patch = {
      kind: "external" as const,
      name: cleanName,
      role: cleanRole,
      // External capacity defaults satisfy the shared Resource validation contract even though capacity views exclude external load.
      ...externalCapacityDefaults(),
      color: NEUTRAL_COLOR,
    };
    try {
      if (resource) {
        if (isStaleEdit(useStore.getState().data.resources, resource.id, resource.updatedAt)) {
          fail(null, m.form_external_err_changed());
          return;
        }
        update(resource.id, patch);
      } else if (add(patch).kind === "blocked") return;
      onClose();
    } catch (e) {
      // Surface store rejection inside the external-resource form so invalid writes cannot fail silently.
      fail(null, resolveErrorMessage(e));
    }
  };

  return (
    <Modal
      title={resource ? m.form_external_edit_title() : m.form_external_add_title()}
      onClose={onClose}
      onSubmit={submit}
      footer={<FormActions onCancel={onClose} />}
    >
      <ExternalFormFields
        name={name}
        onNameChange={setName}
        role={role}
        onRoleChange={setRole}
        error={error}
        errorField={errorField}
        errorId={errorId}
      />
    </Modal>
  );
}
