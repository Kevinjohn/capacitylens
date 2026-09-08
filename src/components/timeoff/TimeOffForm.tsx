import { useMemo, useState } from "react";
import { useStore } from "../../store/useStore";
import { hasPlaceholdersEnabled, resolveTimeZone } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useFieldError, useFieldErrorFocus } from "../../hooks/useFieldError";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import { MAX_NOTE_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { validateText } from "../../lib/validation";
import { isStaleEdit } from "../../lib/isStaleEdit";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { m } from "@/i18n";
import { DateField, FormActions, Modal, RequiredLegend, SelectField, TextField, type Option } from "../common/ui";
import { FieldError } from "../ui/field";
import { buildTimeOffTypeOptions, resolveResourceDisplayName } from "../../lib/metadata";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { ISODate, TimeOff, TimeOffType } from "@capacitylens/shared/types/entities";
import { canSeeTimeOffNote } from "@capacitylens/shared/domain/access";
import { useRole } from "../../auth/permissionContext";

interface TimeOffFormProps {
  timeOff?: TimeOff;
  defaults?: { resourceId?: string; startDate?: ISODate; endDate?: ISODate };
  onClose: () => void;
}

interface TimeOffFieldsProps {
  resourceId: string;
  setResourceId: (value: string) => void;
  resourceOptions: Option[];
  startDate: ISODate | "";
  setStartDate: (value: ISODate) => void;
  endDate: ISODate | "";
  setEndDate: (value: ISODate) => void;
  type: TimeOffType;
  setType: (value: TimeOffType) => void;
  note: string;
  setNote: (value: string) => void;
  canEditNote: boolean;
  errorField: string | null;
  errorId: string;
}

interface TimeOffDraftOptions {
  timeOff: TimeOff | undefined;
  defaults: TimeOffFormProps["defaults"];
  calendarTimeZone: string;
  canEditNote: boolean;
}

function resolveDraftValue<T>(stored: T | undefined, fallback: T | undefined, defaultValue: T): T {
  return stored ?? fallback ?? defaultValue;
}

function useTimeOffDraft({ timeOff, defaults, calendarTimeZone, canEditNote }: TimeOffDraftOptions) {
  const today = todayISO(calendarTimeZone);
  const [resourceId, setResourceId] = useState(resolveDraftValue(timeOff?.resourceId, defaults?.resourceId, ""));
  const [startDate, setStartDate] = useState(resolveDraftValue(timeOff?.startDate, defaults?.startDate, today));
  const [endDate, setEndDate] = useState(resolveDraftValue(timeOff?.endDate, defaults?.endDate, today));
  const [type, setType] = useState<TimeOffType>(timeOff?.type ?? "holiday");
  const initialNote = canEditNote ? (timeOff?.note ?? "") : "";
  const [note, setNote] = useState(initialNote);
  return { resourceId, setResourceId, startDate, setStartDate, endDate, setEndDate, type, setType, note, setNote };
}

type Fail = ReturnType<typeof useFieldError>["fail"];

function validateTimeOffDraft(options: {
  resources: ReturnType<typeof useActiveScopedData>["resources"];
  resourceId: string;
  startDate: ISODate | "";
  endDate: ISODate | "";
  type: TimeOffType;
  note: string;
  canEditNote: boolean;
  fail: Fail;
}) {
  const { resources, resourceId, startDate, endDate, type, note, canEditNote, fail } = options;
  const chosen = resources.find((resource) => resource.id === resourceId);
  if (!chosen || isExternalResource(chosen)) {
    fail("resource", m.form_timeoff_err_choose_resource());
    return null;
  }
  if (!startDate || !endDate) {
    fail("dates", m.form_timeoff_err_dates_required());
    return null;
  }
  if (endDate < startDate) {
    fail("dates", m.form_timeoff_err_end_before_start());
    return null;
  }
  let cleanNote: string | undefined;
  if (canEditNote) {
    const validatedNote = validateText(note, fail, { field: "note", required: false, multiline: true });
    if (validatedNote === null) return null;
    cleanNote = validatedNote || undefined;
  }
  return { basePatch: { resourceId, startDate, endDate, type }, cleanNote };
}

function useTimeOffResourceOptions(
  resources: ReturnType<typeof useActiveScopedData>["resources"],
  placeholdersEnabled: boolean,
  resourceId: string,
): Option[] {
  const filteredResources = useMemo(
    () =>
      resources
        .filter((resource) => !isExternalResource(resource))
        .filter((resource) => placeholdersEnabled || resource.kind !== "placeholder" || resource.id === resourceId),
    [resources, placeholdersEnabled, resourceId],
  );
  return filteredResources.map((resource) => ({
    value: resource.id,
    label: resolveResourceDisplayName(resource),
  }));
}

function saveTimeOff(options: {
  timeOff: TimeOff | undefined;
  resources: ReturnType<typeof useActiveScopedData>["resources"];
  resourceId: string;
  startDate: ISODate | "";
  endDate: ISODate | "";
  type: TimeOffType;
  note: string;
  canEditNote: boolean;
  fail: Fail;
  add: ReturnType<typeof useStore.getState>["addTimeOff"];
  update: ReturnType<typeof useStore.getState>["updateTimeOff"];
  onClose: () => void;
}) {
  const { timeOff, add, update, onClose, canEditNote, fail } = options;
  const draft = validateTimeOffDraft(options);
  if (!draft) return;
  const { basePatch, cleanNote } = draft;
  const patch = canEditNote ? { ...basePatch, note: cleanNote } : basePatch;
  try {
    if (timeOff) {
      if (isStaleEdit(useStore.getState().data.timeOff, timeOff.id, timeOff.updatedAt)) {
        fail(null, m.form_timeoff_err_changed());
        return;
      }
      update(timeOff.id, patch);
    } else add({ ...basePatch, ...(cleanNote ? { note: cleanNote } : {}) });
    onClose();
  } catch (error) {
    fail(null, error instanceof Error ? resolveErrorMessage(error) : m.form_timeoff_err_save_failed());
  }
}

export function TimeOffForm({ timeOff, defaults, onClose }: TimeOffFormProps) {
  const add = useStore((state) => state.addTimeOff);
  const update = useStore((state) => state.updateTimeOff);
  const placeholdersEnabled = useStore((state) => hasPlaceholdersEnabled(state.data, state.activeAccountId));
  const calendarTimeZone = useStore((state) => resolveTimeZone(state.data, state.activeAccountId));
  const resources = useActiveScopedData().resources;
  const role = useRole();
  // Null is the OFF/demo/no-provider mode, where there is no server field projection to enforce.
  const canEditNote = role === null || canSeeTimeOffNote(role);

  const { resourceId, setResourceId, startDate, setStartDate, endDate, setEndDate, type, setType, note, setNote } =
    useTimeOffDraft({ timeOff, defaults, calendarTimeZone, canEditNote });
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  useFieldErrorFocus(fieldError);

  const resourceOptions = useTimeOffResourceOptions(resources, placeholdersEnabled, resourceId);

  const submit = () =>
    saveTimeOff({
      timeOff,
      resources,
      resourceId,
      startDate,
      endDate,
      type,
      note,
      canEditNote,
      fail,
      add,
      update,
      onClose,
    });

  return (
    <Modal
      title={timeOff ? m.form_timeoff_edit_title() : m.form_timeoff_add_title()}
      onClose={onClose}
      onSubmit={submit}
      onEdit={clear}
      footer={<FormActions onCancel={onClose} />}
    >
      <TimeOffFields
        resourceId={resourceId}
        setResourceId={setResourceId}
        resourceOptions={resourceOptions}
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        type={type}
        setType={setType}
        note={note}
        setNote={setNote}
        canEditNote={canEditNote}
        errorField={errorField}
        errorId={errorId}
      />
      <FieldError id={errorId} tabIndex={error && errorField === null ? -1 : undefined}>
        {error}
      </FieldError>
      <RequiredLegend />
    </Modal>
  );
}

function TimeOffFields({
  resourceId,
  setResourceId,
  resourceOptions,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  type,
  setType,
  note,
  setNote,
  canEditNote,
  errorField,
  errorId,
}: TimeOffFieldsProps) {
  return (
    <>
      <SelectField
        label={m.form_timeoff_resource_label()}
        value={resourceId}
        onChange={setResourceId}
        options={resourceOptions}
        placeholder={m.form_timeoff_select_resource_placeholder()}
        required
        invalid={errorField === "resource"}
        describedById={errorId}
        layout="label-control"
      />
      <TimeOffDateFields
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        invalid={errorField === "dates"}
        errorId={errorId}
      />
      <SelectField
        label={m.form_timeoff_type_label()}
        value={type}
        onChange={(value) => setType(value as TimeOffType)}
        options={buildTimeOffTypeOptions()}
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
    </>
  );
}

function TimeOffDateFields({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  invalid,
  errorId,
}: {
  startDate: ISODate | "";
  setStartDate: (value: ISODate) => void;
  endDate: ISODate | "";
  setEndDate: (value: ISODate) => void;
  invalid: boolean;
  errorId: string;
}) {
  return (
    // The date row deliberately spans the modal instead of using its 25/75 rows, matching allocations.
    <div data-timeoff-date-row className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      <DateField
        label={m.form_timeoff_start_label()}
        value={startDate}
        onChange={setStartDate}
        required
        invalid={invalid}
        describedById={errorId}
      />
      <DateField
        label={m.form_timeoff_end_label()}
        value={endDate}
        onChange={setEndDate}
        required
        invalid={invalid}
        describedById={errorId}
      />
    </div>
  );
}
