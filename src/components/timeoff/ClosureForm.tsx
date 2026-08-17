import { useState } from "react";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import type { Closure } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useFieldError, useFieldErrorFocus } from "../../hooks/useFieldError";
import { errorMessage } from "../../lib/errorMessage";
import { isStaleEdit } from "../../lib/staleEdit";
import { validateText } from "../../lib/validation";
import { timeZoneFor } from "../../store/selectors";
import { useStore } from "../../store/useStore";
import { DateField, FormActions, Modal, RequiredLegend, TextField } from "../common/ui";
import { FieldError } from "../ui/field";

export function ClosureForm({ closure, onClose }: { closure?: Closure; onClose: () => void }) {
  const add = useStore((state) => state.addClosure);
  const update = useStore((state) => state.updateClosure);
  const calendarTimeZone = useStore((state) => timeZoneFor(state.data, state.activeAccountId));
  const today = todayISO(calendarTimeZone);
  const [name, setName] = useState(closure?.name ?? "");
  const [startDate, setStartDate] = useState(closure?.startDate ?? today);
  const [endDate, setEndDate] = useState(closure?.endDate ?? today);
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  useFieldErrorFocus(fieldError);

  const submit = () => {
    const cleanName = validateText(name, fail, { requiredMessage: m.form_closure_err_name_required() });
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
    try {
      if (closure) {
        if (isStaleEdit(useStore.getState().data.closures, closure.id, closure.updatedAt)) {
          fail(null, m.form_closure_err_changed());
          return;
        }
        update(closure.id, patch);
      } else {
        add(patch);
      }
      onClose();
    } catch (error) {
      fail(null, error instanceof Error ? errorMessage(error) : m.form_closure_err_save_failed());
    }
  };

  return (
    <Modal
      title={closure ? m.form_closure_edit_title() : m.form_closure_add_title()}
      onClose={onClose}
      onSubmit={submit}
      onEdit={clear}
      footer={<FormActions onCancel={onClose} />}
    >
      <TextField
        label={m.form_closure_name_label()}
        value={name}
        onChange={setName}
        autoFocus
        required
        invalid={errorField === "name"}
        describedById={errorId}
        layout="label-control"
      />
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <DateField
          label={m.form_closure_start_label()}
          value={startDate}
          onChange={setStartDate}
          required
          invalid={errorField === "dates"}
          describedById={errorId}
        />
        <DateField
          label={m.form_closure_end_label()}
          value={endDate}
          onChange={setEndDate}
          required
          invalid={errorField === "dates"}
          describedById={errorId}
        />
      </div>
      <FieldError id={errorId} tabIndex={error && errorField === null ? -1 : undefined}>
        {error}
      </FieldError>
      <RequiredLegend />
    </Modal>
  );
}
