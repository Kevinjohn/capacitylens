import { useRef, useState } from "react";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import type { Closure } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useFieldError, useFieldErrorFocus } from "@/hooks/useFieldError";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { isStaleEdit } from "@/lib/isStaleEdit";
import { parseText } from "@/lib/validation";
import { resolveTimeZone } from "@/store/selectors";
import { useStore } from "@/store/useStore";
import { usePlanningActions, usePlanningDraft } from "@/data/planning/usePlanningActions";
import { DateField, FormActions, Modal, RequiredLegend, TextField } from "@/components/common/ui";
import { FieldError } from "@/components/ui/field";
import { PlanningStatusBanner } from "@/components/PlanningStatusBanner";

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
        invalid={props.errorField === "name"}
        describedById={props.errorId}
        layout="label-control"
      />
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <DateField
          label={m.form_closure_start_label()}
          value={props.startDate}
          onChange={props.onStartDateChange}
          required
          invalid={props.errorField === "dates"}
          describedById={props.errorId}
        />
        <DateField
          label={m.form_closure_end_label()}
          value={props.endDate}
          onChange={props.onEndDateChange}
          required
          invalid={props.errorField === "dates"}
          describedById={props.errorId}
        />
      </div>
      <FieldError id={props.errorId} tabIndex={props.error && props.errorField === null ? -1 : undefined}>
        {props.error}
      </FieldError>
      <RequiredLegend />
    </>
  );
}

/** Creates or edits a company closure with guarded date fields. */
export function ClosureForm({ closure, onClose }: { closure?: Closure; onClose: () => void }) {
  const draft = usePlanningDraft(closure);
  const { addClosure: add, updateClosure: update } = usePlanningActions(draft);
  const submitting = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const calendarTimeZone = useStore((state) => resolveTimeZone(state.data, state.activeAccountId));
  const today = todayISO(calendarTimeZone);
  const [name, setName] = useState(closure?.name ?? "");
  const [startDate, setStartDate] = useState(closure?.startDate ?? today);
  const [endDate, setEndDate] = useState(closure?.endDate ?? today);
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  useFieldErrorFocus(fieldError);

  const submit = async () => {
    if (submitting.current) return;
    const cleanName = parseText(name, fail, { requiredMessage: m.form_closure_err_name_required() });
    if (!cleanName) return;
    if (!startDate || !endDate) {
      fail("dates", m.form_closure_err_dates_required());
      return;
    }
    if (endDate < startDate) {
      fail("dates", m.form_closure_err_end_before_start());
      return;
    }

    const patch = { name: cleanName, startDate, endDate };
    submitting.current = true;
    setIsSubmitting(true);
    try {
      if (closure) {
        if (isStaleEdit(useStore.getState().data.closures, closure.id, closure.updatedAt)) {
          fail(null, m.form_closure_err_changed());
          return;
        }
        await update(closure.id, patch);
      } else {
        if ((await add(patch)).kind === "blocked") return;
      }
      onClose();
    } catch (error) {
      // Surface the rejected closure write at the form boundary so invalid data remains correctable.
      fail(null, error instanceof Error ? resolveErrorMessage(error) : m.form_closure_err_save_failed());
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title={closure ? m.form_closure_edit_title() : m.form_closure_add_title()}
      onClose={onClose}
      onSubmit={() => void submit()}
      onEdit={clear}
      busy={isSubmitting}
      recovery={<PlanningStatusBanner placement="modal" />}
      footer={<FormActions onCancel={onClose} disabled={isSubmitting} />}
    >
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
    </Modal>
  );
}
