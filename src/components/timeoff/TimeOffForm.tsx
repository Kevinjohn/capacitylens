import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import { placeholdersEnabledFor, timeZoneFor } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useFieldError, useFieldErrorFocus } from "../../hooks/useFieldError";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import { MAX_NOTE_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { validateText } from "../../lib/validation";
import { isStaleEdit } from "../../lib/staleEdit";
import { errorMessage } from "../../lib/errorMessage";
import { m } from "@/i18n";
import { DateField, FormActions, Modal, RequiredLegend, SelectField, TextField, type Option } from "../common/ui";
import { FieldError } from "../ui/field";
import { timeOffTypeOptions, resourceDisplayName } from "../../lib/metadata";
import { isCompanyWideTimeOffType, isExternalResource } from "@capacitylens/shared/types/entities";
import type { ISODate, TimeOff, TimeOffType } from "@capacitylens/shared/types/entities";
import { canSeeTimeOffNote } from "@capacitylens/shared/domain/access";
import { useRole } from "../../auth/permissionContext";

// Radix uses the empty string for the unselected placeholder. Keep Everyone in a separate,
// UI-only value domain and translate it to the persisted `null` company-assignee contract.
const EVERYONE_RESOURCE_VALUE = "__capacitylens_everyone__";

export function TimeOffForm({
  timeOff,
  defaults,
  onClose,
}: {
  timeOff?: TimeOff;
  /** Prefill for a new entry (e.g. drawn on the timeline). */
  defaults?: { resourceId?: string; startDate?: ISODate; endDate?: ISODate };
  onClose: () => void;
}) {
  const add = useStore((s) => s.addTimeOff);
  const update = useStore((s) => s.updateTimeOff);
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId));
  const calendarTimeZone = useStore((s) => timeZoneFor(s.data, s.activeAccountId));
  const resources = useActiveScopedData().resources;
  const role = useRole();
  // Null is the OFF/demo/no-provider mode, where there is no server field projection to enforce.
  const canEditNote = role === null || canSeeTimeOffNote(role);

  const [resourceId, setResourceId] = useState(
    timeOff ? (timeOff.resourceId ?? EVERYONE_RESOURCE_VALUE) : (defaults?.resourceId ?? ""),
  );
  const [startDate, setStartDate] = useState(timeOff?.startDate ?? defaults?.startDate ?? todayISO(calendarTimeZone));
  const [endDate, setEndDate] = useState(timeOff?.endDate ?? defaults?.endDate ?? todayISO(calendarTimeZone));
  const [type, setType] = useState<TimeOffType>(timeOff?.type ?? "holiday");
  const [note, setNote] = useState(canEditNote ? (timeOff?.note ?? "") : "");
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  useFieldErrorFocus(fieldError);

  // External / 3rd parties have no capacity, so time off is meaningless for them — exclude them.
  // Placeholders are gated behind a per-account pref (default OFF); when off, drop them too —
  // EXCEPT the entry's currently-selected resource (risk A): keep a hidden placeholder in the
  // options when it's the one already assigned, so editing shows the correct value in the selector
  // instead of silently reassigning the time off to someone else on save.
  // The two filter passes are the only non-trivial cost here; memoised on their actual inputs so
  // they aren't redone on every keystroke elsewhere in the form (e.g. the note field). The label map
  // stays OUTSIDE the memo: `resourceDisplayName` resolves a placeholder's name through `m.*()`,
  // which must keep resolving fresh every render (a stale locale/account switch is otherwise
  // possible — see validation.ts's "getter, not module-scope const" note), so it's rebuilt un-cached
  // each render.
  const filteredResources = useMemo(
    () =>
      resources
        .filter((r) => !isExternalResource(r))
        .filter((r) => placeholdersEnabled || r.kind !== "placeholder" || r.id === resourceId),
    [resources, placeholdersEnabled, resourceId],
  );
  const resourceOptions: Option[] = [
    { value: EVERYONE_RESOURCE_VALUE, label: m.form_timeoff_everyone_option() },
    ...filteredResources.map((r) => ({ value: r.id, label: resourceDisplayName(r) })),
  ];
  const everyoneSelected = resourceId === EVERYONE_RESOURCE_VALUE;
  const typeOptions = timeOffTypeOptions().filter(
    (option) => !everyoneSelected || isCompanyWideTimeOffType(option.value),
  );

  const changeResource = (nextResourceId: string) => {
    setResourceId(nextResourceId);
    if (nextResourceId === EVERYONE_RESOURCE_VALUE && !isCompanyWideTimeOffType(type)) setType("other");
  };

  const submit = () => {
    // Reject an empty pick AND a resource that isn't a valid time-off target: externals have no
    // capacity (the picker omits them, but a draw on an external lane could seed one), so guard the
    // write boundary too rather than persist an orphan time-off the schedule never renders.
    const chosen = everyoneSelected ? null : resources.find((r) => r.id === resourceId);
    if (!everyoneSelected && (!chosen || isExternalResource(chosen))) {
      fail("resource", m.form_timeoff_err_choose_resource());
      return;
    }
    if (!startDate || !endDate) {
      fail("dates", m.form_timeoff_err_dates_required());
      return;
    }
    if (endDate < startDate) {
      fail("dates", m.form_timeoff_err_end_before_start());
      return;
    }
    const basePatch = { resourceId: everyoneSelected ? null : resourceId, startDate, endDate, type };
    let cleanNote: string | undefined;
    if (canEditNote) {
      const validatedNote = validateText(note, fail, {
        field: "note",
        required: false,
        multiline: true,
      });
      if (validatedNote === null) return;
      cleanNote = validatedNote || undefined;
    }
    const patch = canEditNote ? { ...basePatch, note: cleanNote } : basePatch;
    try {
      if (timeOff) {
        if (isStaleEdit(useStore.getState().data.timeOff, timeOff.id, timeOff.updatedAt)) {
          fail(null, m.form_timeoff_err_changed());
          return;
        }
        update(timeOff.id, patch);
      } else add(patch);
      onClose();
    } catch (e) {
      fail(null, e instanceof Error ? errorMessage(e) : m.form_timeoff_err_save_failed());
    }
  };

  return (
    <Modal
      title={timeOff ? m.form_timeoff_edit_title() : m.form_timeoff_add_title()}
      onClose={onClose}
      onSubmit={submit}
      onEdit={clear}
      footer={<FormActions onCancel={onClose} />}
    >
      <SelectField
        label={m.form_timeoff_resource_label()}
        value={resourceId}
        onChange={changeResource}
        options={resourceOptions}
        placeholder={m.form_timeoff_select_resource_placeholder()}
        required
        invalid={errorField === "resource"}
        describedById={errorId}
        layout="label-control"
      />
      <DateField
        label={m.form_timeoff_start_label()}
        value={startDate}
        onChange={setStartDate}
        required
        invalid={errorField === "dates"}
        describedById={errorId}
        layout="label-control"
      />
      <DateField
        label={m.form_timeoff_end_label()}
        value={endDate}
        onChange={setEndDate}
        required
        invalid={errorField === "dates"}
        describedById={errorId}
        layout="label-control"
      />
      <SelectField
        label={m.form_timeoff_type_label()}
        value={type}
        onChange={(v) => setType(v as TimeOffType)}
        options={typeOptions}
        layout="label-control"
      />
      {canEditNote && (
        <TextField
          label={m.form_timeoff_note_label()}
          value={note}
          onChange={setNote}
          maxLength={MAX_NOTE_INPUT_CODE_UNITS}
          invalid={errorField === "note"}
          describedById={errorId}
          layout="label-control"
        />
      )}
      <FieldError id={errorId} tabIndex={error && errorField === null ? -1 : undefined}>
        {error}
      </FieldError>
      <RequiredLegend />
    </Modal>
  );
}
