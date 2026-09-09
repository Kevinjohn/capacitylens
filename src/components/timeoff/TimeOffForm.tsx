import { useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../../store/useStore";
import { hasPlaceholdersEnabled, resolveTimeZone } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useFieldError, useFieldErrorFocus } from "../../hooks/useFieldError";
import { todayISO } from "@capacitylens/shared/lib/dateMath";
import { MAX_NOTE_INPUT_CODE_UNITS } from "@capacitylens/shared/lib/strings";
import { m } from "@/i18n";
import { DateField, FormActions, Modal, RequiredLegend, SelectField, TextField, type Option } from "../common/ui";
import { FieldError } from "../ui/field";
import { buildTimeOffTypeOptions, resolveResourceDisplayName } from "../../lib/metadata";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { ISODate, TimeOff, TimeOffType } from "@capacitylens/shared/types/entities";
import { canSeeTimeOffNote } from "@capacitylens/shared/domain/access";
import { useRole } from "../../auth/permissionContext";
import { useTimeOffRepeat } from "./useTimeOffRepeat";
import { TimeOffRepeatFields } from "./TimeOffRepeatFields";
import { saveTimeOff } from "./timeOffFormSubmission";

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
  repeatFields?: ReactNode;
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

function buildTimeOffRepeatFields(options: {
  timeOff: TimeOff | undefined;
  startDate: ISODate | "";
  repeatState: ReturnType<typeof useTimeOffRepeat>;
  errorField: string | null;
  errorId: string;
}): ReactNode {
  if (options.timeOff) return undefined;
  const { repeat, repeatUntil, maximum, preview, changeRepeat, changeRepeatUntil } = options.repeatState;
  return (
    <TimeOffRepeatFields
      startDate={options.startDate}
      repeat={repeat}
      repeatUntil={repeatUntil}
      repeatUntilMaximum={maximum}
      projection={preview}
      errorField={options.errorField}
      errorId={options.errorId}
      onRepeatChange={changeRepeat}
      onRepeatUntilChange={changeRepeatUntil}
    />
  );
}

/** Null is OFF/demo mode, where there is no server note projection to enforce. */
function useCanEditTimeOffNote(): boolean {
  const role = useRole();
  return role === null || canSeeTimeOffNote(role);
}

export function TimeOffForm({ timeOff, defaults, onClose }: TimeOffFormProps) {
  const add = useStore((state) => state.addTimeOff);
  const addMany = useStore((state) => state.addTimeOffs);
  const update = useStore((state) => state.updateTimeOff);
  const placeholdersEnabled = useStore((state) => hasPlaceholdersEnabled(state.data, state.activeAccountId));
  const calendarTimeZone = useStore((state) => resolveTimeZone(state.data, state.activeAccountId));
  const resources = useActiveScopedData().resources;
  const canEditNote = useCanEditTimeOffNote();

  const fields = useTimeOffDraft({ timeOff, defaults, calendarTimeZone, canEditNote });
  const acceptedSubmission = useRef(false);
  const repeatState = useTimeOffRepeat(fields);
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  useFieldErrorFocus(fieldError);

  const resourceOptions = useTimeOffResourceOptions(resources, placeholdersEnabled, fields.resourceId);
  const repeatFields = buildTimeOffRepeatFields({
    timeOff,
    startDate: fields.startDate,
    repeatState,
    errorField,
    errorId,
  });

  const submit = () =>
    saveTimeOff({
      timeOff,
      resources,
      ...fields,
      canEditNote,
      fail,
      add,
      addMany,
      update,
      repeat: repeatState.repeat,
      repeatUntil: repeatState.repeatUntil,
      acceptedSubmission,
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
        {...fields}
        resourceOptions={resourceOptions}
        canEditNote={canEditNote}
        errorField={errorField}
        errorId={errorId}
        repeatFields={repeatFields}
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
  repeatFields,
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
      {repeatFields}
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
