import { useState } from "react";
import { useStore } from "../../store/useStore";
import { useFieldError } from "../../hooks/useFieldError";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { validateText } from "../../lib/validation";
import { isStaleEdit } from "../../lib/isStaleEdit";
import { m } from "@/i18n";
import { FormActions, Modal, RequiredLegend, TextField } from "../common/ui";
import { FieldError } from "../ui/field";
import { NEUTRAL_COLOR } from "../../lib/palette";
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

/**
 * Add/edit an external / 3rd-party party — a trimmed resource form. It captures only a COMPANY
 * name (required) and an optional descriptor. The capacity fields (hours, working days, discipline,
 * employment, project) don't apply — externals have no capacity — so they're stored as unused
 * silent defaults the rest of the app never reads. Colour is the single neutral swatch (no picker),
 * per DECISIONS.md "external kind". Store rejections surface as a form error, like ResourceForm.
 */
export function ExternalForm({ resource, onClose }: { resource?: Resource; onClose: () => void }) {
  const add = useStore((state) => state.addResource);
  const update = useStore((state) => state.updateResource);
  const [name, setName] = useState(resource?.name ?? "");
  const [role, setRole] = useState(resource?.role ?? "");
  const { error, errorField, errorId, fail } = useFieldError();

  const submit = () => {
    const cleanName = validateText(name, fail, {
      field: "name",
      required: true,
      requiredMessage: m.form_external_err_company_required(),
    });
    if (cleanName === null) return;
    const cleanRole = validateText(role, fail, { field: "role", required: false });
    if (cleanRole === null) return;
    const patch = {
      kind: "external" as const,
      name: cleanName,
      role: cleanRole,
      // Capacity fields don't apply to an external — store the unused silent defaults (ONE source,
      // shared with seed + fixtures) so the entity stays valid (the store asserts a non-empty working
      // week + positive hours) while the scheduler / forms never show or read them.
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
      } else add(patch);
      onClose();
    } catch (e) {
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
