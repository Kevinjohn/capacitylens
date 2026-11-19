import { useFormLifetimeClose } from '@/hooks/useFormLifetimeClose';
import { useState } from 'react';
import { useCompanyToday } from '@/hooks/useCompanyToday';
import type { Closure } from '@capacitylens/shared/types/entities';
import { m } from '@/i18n';
import { useEditSubmit } from '@/hooks/useEditSubmit';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { useFieldError, useFieldErrorFocus } from '@/hooks/useFieldError';
import { parseText } from '@/lib/validation';
import { useStore } from '@/store/useStore';
import { DateField, FormActions, Modal, RequiredLegend, TextField } from '@/components/common/ui';
import { FieldError } from '@/components/ui/field';

type ClosureFormFieldsProps = {
  name: string;
  onNameChange: (value: string) => void;
  startDate: string;
  onStartDateChange: (value: string) => void;
  endDate: string;
  onEndDateChange: (value: string) => void;
  error: string | null;
  errorField: string | null;
  errorId: string;
};

function ClosureFormFields(props: ClosureFormFieldsProps) {
  return (
    <>
      <TextField
        label={m.form_closure_name_label()}
        value={props.name}
        onChange={props.onNameChange}
        autoFocus
        required
        invalid={props.errorField === 'name'}
        describedById={props.errorId}
        layout="label-control"
      />
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <DateField
          label={m.form_closure_start_label()}
          value={props.startDate}
          onChange={props.onStartDateChange}
          required
          invalid={props.errorField === 'dates'}
          describedById={props.errorId}
        />
        <DateField
          label={m.form_closure_end_label()}
          value={props.endDate}
          onChange={props.onEndDateChange}
          required
          invalid={props.errorField === 'dates'}
          describedById={props.errorId}
        />
      </div>
      <FieldError
        id={props.errorId}
        tabIndex={props.error && props.errorField === null ? -1 : undefined}
      >
        {props.error}
      </FieldError>
      <RequiredLegend />
    </>
  );
}

/** Creates or edits a company closure with guarded date fields. */
export function ClosureForm({
  closure,
  onClose: close,
}: {
  closure?: Closure;
  onClose: () => void;
}) {
  const onClose = useFormLifetimeClose(close);
  const add = useStore((state) => state.addClosure);
  const update = useStore((state) => state.updateClosure);
  const today = useCompanyToday();
  const [name, setName] = useState(closure?.name ?? '');
  const [startDate, setStartDate] = useState(closure?.startDate ?? today);
  const [endDate, setEndDate] = useState(closure?.endDate ?? today);
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  useFieldErrorFocus(fieldError);
  const closures = useStore((state) => state.data.closures);
  const { pending, submit } = useEditSubmit({
    editing: closure,
    rows: closures,
    staleMessage: m.form_closure_err_changed,
    failedMessage: m.form_closure_err_save_failed,
    cancelledMessage: resolveErrorMessage,
    fail,
    onSaved: onClose,
  });

  const prepareSave = () => {
    const cleanName = parseText(name, fail, {
      requiredMessage: m.form_closure_err_name_required(),
    });
    if (!cleanName) return null;
    if (!startDate || !endDate) {
      fail('dates', m.form_closure_err_dates_required());
      return null;
    }
    if (endDate < startDate) {
      fail('dates', m.form_closure_err_end_before_start());
      return null;
    }
    const patch = { name: cleanName, startDate, endDate };
    return closure ? () => update(closure.id, patch, closure.updatedAt) : () => add(patch);
  };

  return (
    <Modal
      title={closure ? m.form_closure_edit_title() : m.form_closure_add_title()}
      onClose={onClose}
      onSubmit={() => {
        void submit(prepareSave);
      }}
      onEdit={clear}
      footer={<FormActions onCancel={onClose} disabled={pending} />}
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <ClosureFormFields
          name={name}
          onNameChange={setName}
          startDate={startDate}
          onStartDateChange={setStartDate}
          endDate={endDate}
          onEndDateChange={setEndDate}
          error={error}
          errorField={errorField}
          errorId={errorId}
        />
      </fieldset>
    </Modal>
  );
}
