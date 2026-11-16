import { useFormLifetimeClose } from '@/hooks/useFormLifetimeClose';
import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { useEditSubmit } from '@/hooks/useEditSubmit';
import { useFieldError } from '@/hooks/useFieldError';
import { parseText } from '@/lib/validation';
import { m } from '@/i18n';
import { FormActions, Modal, RequiredLegend, TextField } from '@/components/common/ui';
import { FieldError } from '@/components/ui/field';
import { NEUTRAL_COLOR } from '@/lib/palette';
import { externalCapacityDefaults } from '@capacitylens/shared/types/entities';
import type { Resource } from '@capacitylens/shared/types/entities';

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
        invalid={props.errorField === 'name'}
        describedById={props.errorId}
        layout="label-control"
      />
      <TextField
        label={m.form_external_descriptor_label()}
        value={props.role}
        onChange={props.onRoleChange}
        placeholder={m.form_external_descriptor_placeholder()}
        invalid={props.errorField === 'role'}
        describedById={props.errorId}
        layout="label-control"
      />
      <FieldError id={props.errorId}>{props.error}</FieldError>
      <RequiredLegend />
    </>
  );
}

/** Creates or edits an external company and optional descriptor. Externals have no capacity; neutral colour and inert capacity defaults preserve the Resource entity contract. */
export function ExternalForm({
  resource,
  onClose: close,
}: {
  resource?: Resource;
  onClose: () => void;
}) {
  const onClose = useFormLifetimeClose(close);
  const add = useStore((state) => state.addResource);
  const update = useStore((state) => state.updateResource);
  const [name, setName] = useState(resource?.name ?? '');
  const [role, setRole] = useState(resource?.role ?? '');
  const { error, errorField, errorId, fail } = useFieldError();
  const resources = useStore((state) => state.data.resources);
  const { pending, submit } = useEditSubmit({
    editing: resource,
    rows: resources,
    staleMessage: m.form_external_err_changed,
    fail,
    onSaved: onClose,
  });

  const prepareSave = () => {
    const cleanName = parseText(name, fail, {
      field: 'name',
      required: true,
      requiredMessage: m.form_external_err_company_required(),
    });
    if (cleanName === null) return null;
    const cleanRole = parseText(role, fail, { field: 'role', required: false });
    if (cleanRole === null) return null;
    const patch = {
      kind: 'external' as const,
      name: cleanName,
      role: cleanRole,
      // External capacity defaults satisfy the shared Resource validation contract even though capacity views exclude external load.
      ...externalCapacityDefaults(),
      color: NEUTRAL_COLOR,
    };
    return resource ? () => update(resource.id, patch) : () => add(patch);
  };

  return (
    <Modal
      title={resource ? m.form_external_edit_title() : m.form_external_add_title()}
      onClose={onClose}
      onSubmit={() => {
        void submit(prepareSave);
      }}
      footer={<FormActions onCancel={onClose} disabled={pending} />}
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <ExternalFormFields
          name={name}
          onNameChange={setName}
          role={role}
          onRoleChange={setRole}
          error={error}
          errorField={errorField}
          errorId={errorId}
        />
      </fieldset>
    </Modal>
  );
}
