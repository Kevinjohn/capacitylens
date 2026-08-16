import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { format } from "date-fns";
import { useStore } from "../../store/useStore";
import { useActiveScopedData } from "../../store/useScopedData";
import { daysInclusive, eachDayISO, MAX_ISO_DATE, parseDate, todayISO } from "@capacitylens/shared/lib/dateMath";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { defaultAccountWorkingDays, normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import {
  generateRepeatingStartDates,
  defaultRepeatUntilDate,
  maximumRepeatUntilDate,
} from "@capacitylens/shared/lib/repeatingDates";
import { newId } from "@capacitylens/shared/lib/id";
import {
  blockHoursPerDay,
  daysOfWorkFor,
  endDateForSpan,
  hoursPerDayFor,
  MAX_SPAN_DAYS,
  maxSpanDaysForStart,
  spanDays,
} from "@capacitylens/shared/lib/schedulingDays";
import {
  externalEnabledFor,
  inlineActivityCreateEnabledFor,
  placeholdersEnabledFor,
  schedulingModeFor,
  timeZoneFor,
} from "../../store/selectors";
import { validateAllocationAssignment } from "@capacitylens/shared/lib/integrity";
import { validateText } from "../../lib/validation";
import { domainErrorMessage, errorMessage } from "../../lib/errorMessage";
import { m } from "@/i18n";
import {
  MAX_NAME_INPUT_CODE_UNITS,
  MAX_NOTE_INPUT_CODE_UNITS,
  MAX_NOTE_LENGTH,
} from "@capacitylens/shared/lib/strings";
import { Plus } from "lucide-react";
import {
  DateField,
  CheckboxField,
  Modal,
  NumberField,
  RequiredLegend,
  SegmentedField,
  SelectField,
  TextField,
  type Option,
} from "../common/ui";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { FieldError } from "../ui/field";
import {
  capacityAdvisory,
  capacityAllocationsForMode,
  formatCapacityAdvisory,
  scheduledHoursOnDay,
} from "../../lib/capacity";
import { allocationStatusOptions, resourceDisplayName } from "../../lib/metadata";
import {
  carriesHourlyLoad,
  FULL_DAY_HOURS,
  isExternalResource,
  MAX_HOURS_PER_DAY,
} from "@capacitylens/shared/types/entities";
import type {
  Activity,
  AllocationStatus,
  ISODate,
  Resource,
  SchedulingMode,
} from "@capacitylens/shared/types/entities";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { useFieldError, useFieldErrorFocus } from "../../hooks/useFieldError";
import { useCanEdit } from "../../auth/permissionContext";
import { ConfirmDialog } from "../common/dialogs";
import { RepeatedAllocationDeleteDialog } from "./RepeatedAllocationDeleteDialog";
import { buildActivityOptions } from "./activityOptions";
import { undoShortcut } from "../../lib/keyboardShortcuts";
import { formatShortDate } from "../../lib/dateDisplay";
import {
  projectAllocationDates,
  repeatingAllocationAdvisory,
  repeatPatternForSelection,
  type RepeatSelection,
} from "../../lib/repeatingAllocations";
import { deriveEndDate, validateAllocationDraft } from "./allocationDraft";

/** Snap a seeded days-of-work value to 6 decimals: enough to erase float round-trip
 *  noise (e.g. 8 × 3/7 × 7/8 = 2.9999…) WITHOUT distorting a legitimate fraction
 *  (½ → 0.5, ⅛-day → 1.875). Keeping the seed exact means re-deriving hours on a
 *  no-op save returns the original value rather than drifting it. */
const roundDays = (n: number) => Math.round(n * 1e6) / 1e6;
/** 2-dp rounding for the human-readable "…h/day" hint only — never fed back into a value. */
const round2 = (n: number) => Math.round(n * 100) / 100;

const INTERNAL_PROJECT_SELECTION = "__allocation_internal__";
const ANY_PROJECT_SELECTION = "__allocation_any_project__";

/** Keeps compound controls and their supporting text inside the shared 75% control column. */
function AllocationControlColumn({ children }: { children: ReactNode }) {
  return (
    <div data-allocation-control-column className="min-w-0 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:gap-3">
      <span aria-hidden="true" className="hidden sm:block" />
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

const compoundControlsClassName = "flex min-w-0 gap-2 [&>*]:min-w-0 [&>*]:flex-1";

/** The raw Start/End pair, for the modes that take a literal date range rather than deriving the
 *  end from a span (see `usesTypedDateRange`). Both fields report the SAME `dates` error field, so
 *  they are invalid together — which is the reason they live in one component instead of two
 *  hand-kept copies that could drift apart. */
function DateRangeFields({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  invalid,
  describedById,
}: {
  startDate: ISODate;
  endDate: ISODate;
  onStartChange: (value: ISODate) => void;
  onEndChange: (value: ISODate) => void;
  invalid: boolean;
  describedById?: string;
}) {
  return (
    <div className={compoundControlsClassName}>
      <DateField
        label={m.form_allocation_start_date_label()}
        value={startDate}
        onChange={onStartChange}
        required
        invalid={invalid}
        describedById={describedById}
      />
      <DateField
        label={m.form_allocation_end_label()}
        value={endDate}
        onChange={onEndChange}
        required
        invalid={invalid}
        describedById={describedById}
      />
    </div>
  );
}

function projectSelectionForActivity(activity: Activity | undefined): string {
  if (activity?.kind === "repeatable") return ANY_PROJECT_SELECTION;
  if (activity?.kind === "project" && activity.projectId) return activity.projectId;
  return INTERNAL_PROJECT_SELECTION;
}

function activityScopeForProjectSelection(selection: string): { kind: Activity["kind"]; projectId?: string } {
  if (selection === INTERNAL_PROJECT_SELECTION) return { kind: "internal" };
  if (selection === ANY_PROJECT_SELECTION) return { kind: "repeatable" };
  return { kind: "project", projectId: selection };
}

const repeatOptions = (): Option[] => [
  { value: "none", label: m.form_allocation_repeat_none() },
  { value: "weekly", label: m.form_allocation_repeat_weekly() },
  { value: "every-two-weeks", label: m.form_allocation_repeat_every_two_weeks() },
  { value: "every-three-weeks", label: m.form_allocation_repeat_every_three_weeks() },
  { value: "every-four-weeks", label: m.form_allocation_repeat_every_four_weeks() },
  { value: "monthly", label: m.form_allocation_repeat_monthly() },
];

type AllocationModalProps =
  | { allocationId: string; onClose: () => void }
  | {
      create: { resourceId: string; startDate: ISODate; endDate: ISODate };
      onClose: () => void;
    };

interface EffectiveAllocationInput {
  resource: Resource | undefined;
  mode: SchedulingMode;
  startDate: ISODate;
  endDate: ISODate;
  hoursPerDay: number;
  daysOver: number;
  daysOfWork: number;
  ignoreWeekends: boolean;
}

function effectiveAllocationValues({
  resource,
  mode,
  startDate,
  endDate,
  hoursPerDay,
  daysOver,
  daysOfWork,
  ignoreWeekends,
}: EffectiveAllocationInput) {
  const external = !!resource && isExternalResource(resource);
  const validDaysOver = Number.isSafeInteger(daysOver) && daysOver >= 1 && daysOver <= MAX_SPAN_DAYS;
  const spanOpts = { workingDays: resource?.workingDays, ignoreWeekends };
  const maximumDaysOver = startDate ? maxSpanDaysForStart(startDate, spanOpts) : MAX_SPAN_DAYS;
  const spanLimitedByDateDomain = !!startDate && daysInclusive(startDate, MAX_ISO_DATE) < MAX_SPAN_DAYS;
  const spanFitsDateDomain = !!startDate && validDaysOver && daysOver <= maximumDaysOver;
  const spanEnd = startDate
    ? endDateForSpan(startDate, validDaysOver && spanFitsDateDomain ? daysOver : 1, spanOpts)
    : endDate;
  const effective = external
    ? { endDate, hoursPerDay: 0 }
    : mode === "blocks"
      ? { endDate: spanEnd, hoursPerDay: blockHoursPerDay(FULL_DAY_HOURS) }
      : mode === "days"
        ? {
            endDate: spanEnd,
            hoursPerDay: hoursPerDayFor(daysOfWork, daysOver, FULL_DAY_HOURS),
          }
        : { endDate, hoursPerDay };
  return {
    resource,
    external,
    validDaysOver,
    spanFitsDateDomain,
    maximumDaysOver,
    spanLimitedByDateDomain,
    ...effective,
  };
}

export function AllocationModal(props: AllocationModalProps) {
  const { onClose } = props;
  const canEdit = useCanEdit();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = useActiveScopedData();
  const addAllocation = useStore((s) => s.addAllocation);
  const addAllocations = useStore((s) => s.addAllocations);
  const updateAllocation = useStore((s) => s.updateAllocation);
  const deleteAllocation = useStore((s) => s.deleteAllocation);
  const deleteAllocationSeriesFrom = useStore((s) => s.deleteAllocationSeriesFrom);
  const addActivity = useStore((s) => s.addActivity);
  const mode = useStore((s) => schedulingModeFor(s.data, s.activeAccountId));
  const activeAccount = useStore((state) =>
    state.data.accounts.find((account) => account.id === state.activeAccountId),
  );
  const accountWorkingDays = useMemo(() => {
    const weekStartsOn = activeAccount?.weekStartsOn ?? 1;
    return activeAccount?.workingDays === undefined
      ? defaultAccountWorkingDays(weekStartsOn)
      : normalizeAccountWorkingDays(activeAccount.workingDays, weekStartsOn);
  }, [activeAccount]);
  // Per-account view pref (default OFF): when off, placeholders are dropped from the assignee
  // picker (except an already-assigned one — see resourceOptions below for risk A).
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId));
  // Per-account view pref (default OFF): when off, external / 3rd parties are dropped from the
  // assignee picker (except an already-assigned one — same risk-A escape hatch as placeholders).
  const externalEnabled = useStore((s) => externalEnabledFor(s.data, s.activeAccountId));
  // Per-account pref (default ON): when off, the inline "Add activity" input + button is not rendered.
  // The Activity SelectField still works normally — you pick from the existing activity list.
  const inlineActivityCreateEnabled = useStore((s) => inlineActivityCreateEnabledFor(s.data, s.activeAccountId));
  const calendarTimeZone = useStore((s) => timeZoneFor(s.data, s.activeAccountId));
  const isDays = mode === "days";
  const isBlocks = !carriesHourlyLoad(mode);

  const editId = "allocationId" in props ? props.allocationId : undefined;
  const create = "create" in props ? props.create : undefined;
  const editing = editId ? data.allocations.find((a) => a.id === editId) : undefined;

  // The assignee is looked up on every render (the initial seed, the live effective values, and the
  // picker's change handler all ask for one by id), so index the roster once instead.
  const resourceById = useMemo(() => new Map(data.resources.map((r) => [r.id, r])), [data.resources]);

  const initialActivity = editing ? data.activities.find((act) => act.id === editing.activityId) : undefined;
  const initialResourceId = editing?.resourceId ?? create?.resourceId ?? "";
  const initialResource = resourceById.get(initialResourceId);
  const initialEffectiveWeek = initialResource ? effectiveWorkingWeek(initialResource, accountWorkingDays) : null;
  const initialLocked = initialResource?.kind === "placeholder" ? initialResource.projectId : undefined;
  const initialStart = editing?.startDate ?? create?.startDate ?? todayISO(calendarTimeZone);
  const initialScheduledHours =
    initialResource && initialEffectiveWeek
      ? scheduledHoursOnDay(initialResource, initialStart, initialEffectiveWeek)
      : FULL_DAY_HOURS;

  const [resourceId, setResourceId] = useState(initialResourceId);
  // Editing derives the exact activity scope so project-less Internal and Any Project work no
  // longer reopen as one ambiguous bucket. `initialLocked` remains only the create-time default
  // for a placeholder's bound project.
  const [projectSelection, setProjectSelection] = useState(
    editing ? projectSelectionForActivity(initialActivity) : (initialLocked ?? INTERNAL_PROJECT_SELECTION),
  );
  const [activityId, setActivityId] = useState(editing?.activityId ?? "");
  const [startDate, setStartDate] = useState<ISODate>(initialStart);
  const [endDate, setEndDate] = useState<ISODate>(editing?.endDate ?? create?.endDate ?? todayISO(calendarTimeZone));
  const [hoursPerDay, setHoursPerDay] = useState(editing?.hoursPerDay ?? (initialScheduledHours || FULL_DAY_HOURS));
  const [status, setStatus] = useState<AllocationStatus>(editing?.status ?? "confirmed");
  const [note, setNote] = useState(editing?.note ?? "");
  const [noteEdited, setNoteEdited] = useState(false);
  const [ignoreWeekends, setIgnoreWeekends] = useState(editing?.ignoreWeekends ?? false);
  const [repeat, setRepeat] = useState<RepeatSelection>("none");
  const [repeatUntil, setRepeatUntil] = useState("");
  const repeatUntilIsSuggested = useRef(false);
  // Days-mode inputs (used only when isDays). For an EXISTING allocation we invert
  // hours/dates against the assignee's working week; for a NEW one we honour the span
  // the user drew on the lane (start..end) at full-time load, mirroring how hourly
  // create defaults hours to a full working day across the same range.
  const seedEnd = editing?.endDate ?? create?.endDate;
  const initialDaysOpts = {
    workingDays: initialResource?.workingDays,
    ignoreWeekends: editing?.ignoreWeekends ?? false,
  };
  const initialDaysOver = seedEnd ? Math.max(1, spanDays(initialStart, seedEnd, initialDaysOpts)) : 1;
  // NumberField can expose a transient 0 while the user clears the number input. Submission below
  // validates daysOver explicitly; the defensive 1 used for the live preview is never persisted.
  const [daysOver, setDaysOver] = useState(initialDaysOver);
  const initialCapacityHours =
    initialResource && initialEffectiveWeek
      ? eachDayISO(initialStart, seedEnd ?? initialStart).reduce(
          (sum, day) => sum + scheduledHoursOnDay(initialResource, day, initialEffectiveWeek),
          0,
        )
      : initialDaysOver * FULL_DAY_HOURS;
  const [daysOfWork, setDaysOfWork] = useState(
    editing
      ? roundDays(daysOfWorkFor(editing.hoursPerDay, initialDaysOver, FULL_DAY_HOURS))
      : roundDays(initialCapacityHours > 0 ? initialCapacityHours / FULL_DAY_HOURS : initialDaysOver),
  );
  const [newActivityName, setNewActivityName] = useState("");
  const [inlineActivityOption, setInlineActivityOption] = useState<
    (Option & { kind: Activity["kind"]; projectId?: string }) | null
  >(null);
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  useFieldErrorFocus(fieldError);

  // If the edited allocation is removed out from under us (e.g. undo), close
  // rather than silently turning into a "create" that would resurrect it.
  useEffect(() => {
    if (editId && !editing) onClose();
  }, [editId, editing, onClose]);

  const effectiveValues = useMemo(
    () =>
      effectiveAllocationValues({
        resource: resourceById.get(resourceId),
        mode,
        startDate,
        endDate,
        hoursPerDay,
        daysOver,
        daysOfWork,
        ignoreWeekends,
      }),
    [resourceById, daysOfWork, daysOver, endDate, hoursPerDay, ignoreWeekends, mode, resourceId, startDate],
  );
  const {
    resource: selectedResource,
    external: isExternal,
    validDaysOver,
    spanFitsDateDomain,
    maximumDaysOver,
    spanLimitedByDateDomain,
    endDate: effEndDate,
    hoursPerDay: effHoursPerDay,
  } = effectiveValues;
  const selectedEffectiveWeek = useMemo(
    () => (selectedResource ? effectiveWorkingWeek(selectedResource, accountWorkingDays) : null),
    [accountWorkingDays, selectedResource],
  );
  // External and hourly allocations both collect a raw Start/End pair; blocks and days derive their
  // end from a (start, days-over) span instead. ONE predicate drives both the fields that render and
  // the range validation on save, so the form can never validate a pair it did not show.
  const usesTypedDateRange = isExternal || (!isBlocks && !isDays);
  const isPlaceholder = selectedResource?.kind === "placeholder";
  // External / 3rd-party assignees carry no hours: the modal collects just a date span and
  // persists hoursPerDay 0 (like a 'blocks' booking), with no capacity advisory.
  const lockedProjectId = isPlaceholder ? selectedResource?.projectId : undefined;

  // Effective range/hours fed to the capacity check and the store. In days mode the
  // end date and hours/day are DERIVED from (start, days of work, days over) against
  // the assignee's working week; in hourly mode the typed fields are used as-is.
  // Effective end date + hours from the assignee kind + the account's scheduling mode:
  //   external → a plain typed start/end span, no load (hoursPerDay 0);
  //   blocks   → a (start, days-over) span, no load (0);
  //   days     → a (start, days-over) span, hours rescaled to fit the work volume;
  //   hourly   → the typed end + hours as-is.
  // Raw End-date modes need the same finite span boundary as Days/Blocks. Use the O(1) calendar
  // difference here: deriving the range with eachDayISO just to validate it would itself recreate
  // the multi-million-day render freeze this guard prevents.
  const typedDateSpanDays = startDate && endDate ? daysInclusive(startDate, endDate) : 0;
  const typedDateSpanTooLong = typedDateSpanDays > MAX_SPAN_DAYS;
  const repeatToday = todayISO(calendarTimeZone);
  const repeatUntilMinimum = isValidISODate(startDate) && startDate > repeatToday ? startDate : repeatToday;
  const repeatUntilMaximum = isValidISODate(startDate) ? maximumRepeatUntilDate(startDate) : undefined;

  useEffect(() => {
    if (repeat !== "none" && repeatUntilIsSuggested.current && isValidISODate(startDate)) {
      setRepeatUntil(defaultRepeatUntilDate(startDate));
    }
  }, [repeat, startDate]);

  const onRepeatChange = (value: string) => {
    const next = value as RepeatSelection;
    if (repeat === "none" && next !== "none" && isValidISODate(startDate)) {
      repeatUntilIsSuggested.current = true;
      setRepeatUntil(defaultRepeatUntilDate(startDate));
    } else if (next === "none") {
      repeatUntilIsSuggested.current = false;
      setRepeatUntil("");
    }
    setRepeat(next);
  };

  const onRepeatUntilChange = (value: string) => {
    repeatUntilIsSuggested.current = false;
    setRepeatUntil(value);
  };

  // Repeating preview/advisory inputs mirror the effective persisted fields without invoking the
  // submit validator (which owns focus/error side effects). Invalid partial form state gets no
  // preview; a supported-domain failure is surfaced when Save is attempted.
  const repeatProjection = useMemo(() => {
    if (!create || repeat === "none" || !selectedResource || !resourceId || !activityId) return null;
    if (!isValidISODate(startDate) || !isValidISODate(effEndDate) || effEndDate < startDate) return null;
    if (
      !isValidISODate(repeatUntil) ||
      repeatUntil < repeatUntilMinimum ||
      !repeatUntilMaximum ||
      repeatUntil > repeatUntilMaximum
    )
      return null;
    if (daysInclusive(startDate, effEndDate) > MAX_SPAN_DAYS) return null;
    if ((isDays || isBlocks) && (!validDaysOver || !spanFitsDateDomain)) return null;
    if (isDays && !(daysOfWork > 0)) return null;
    if (
      !isExternal &&
      !isBlocks &&
      !(Number.isFinite(effHoursPerDay) && effHoursPerDay > 0 && effHoursPerDay <= MAX_HOURS_PER_DAY)
    )
      return null;
    const activity = data.activities.find((candidate) => candidate.id === activityId);
    if (!activity || !validateAllocationAssignment(selectedResource, activity.projectId).ok) return null;
    try {
      const { startDates } = generateRepeatingStartDates(startDate, repeatUntil, repeatPatternForSelection(repeat));
      const drafts = projectAllocationDates(
        {
          resourceId,
          activityId,
          startDate,
          endDate: effEndDate,
          hoursPerDay: effHoursPerDay,
          status,
          note: note || undefined,
          ignoreWeekends: isExternal ? true : ignoreWeekends,
        },
        startDates,
        { schedulingMode: mode, daysOver, resource: selectedResource },
      );
      return { drafts, startDates };
    } catch (error) {
      // A near-boundary date can be valid input while a projected occurrence cannot fit. Save owns
      // the localized error surface; invariant/programming errors remain loud instead of disappearing.
      if (error instanceof RangeError) return null;
      throw error;
    }
  }, [
    activityId,
    create,
    data.activities,
    daysOfWork,
    daysOver,
    effEndDate,
    effHoursPerDay,
    ignoreWeekends,
    isBlocks,
    isDays,
    isExternal,
    mode,
    note,
    repeat,
    repeatUntil,
    repeatUntilMaximum,
    repeatUntilMinimum,
    resourceId,
    selectedResource,
    spanFitsDateDomain,
    startDate,
    status,
    validDaysOver,
  ]);

  // Non-blocking capacity advisory (DECISIONS.md: "advisory at allocation time"). The drag-move
  // path shows this as a post-commit toast; surface it HERE too — on the create/edit surface that
  // every keyboard user and every "+"-create reaches. Saving stays allowed (advisory, never a block).
  const advisory = useMemo(() => {
    // External parties have no capacity — never show an over-capacity / time-off advisory.
    if (isExternal) return null;
    // A malformed/reversed span and a range beyond the form's finite work bound get no advisory.
    // This check is O(1) and runs before capacityAdvisory can materialise one ISO string per day.
    const span = startDate && effEndDate ? daysInclusive(startDate, effEndDate) : 0;
    if (!selectedResource || !selectedEffectiveWeek || !startDate || !effEndDate || span < 1 || span > MAX_SPAN_DAYS) {
      return null;
    }
    // Project the existing load through the account's scheduling mode BEFORE counting it: in blocks
    // mode a bar carries placement but no hourly load, so an account that switched to blocks with
    // legacy hourly allocations must not be advised "over capacity" here while the grid's markers
    // (schedulerModel) and the drag-commit toast (useAllocationGesture) — both of which project the
    // same way — show nothing. Every capacity surface reads the same projected load.
    const others = capacityAllocationsForMode(
      data.allocations.filter((a) => a.resourceId === resourceId && a.id !== editId),
      isBlocks,
    );
    const resourceTimeOff = data.timeOff.filter((t) => t.resourceId === resourceId);
    if (create && repeat !== "none") {
      if (!repeatProjection) return null;
      // The repeat variant counts whole OCCURRENCES rather than days; the two tallies otherwise read
      // and render identically, so they share the one advisory sentence builder.
      const { overCapacityAllocations, timeOffAllocations } = repeatingAllocationAdvisory(
        selectedResource,
        others,
        resourceTimeOff,
        repeatProjection.drafts,
        selectedEffectiveWeek,
      );
      return (
        formatCapacityAdvisory({ overDays: overCapacityAllocations, timeOffDays: timeOffAllocations }, "repeat") || null
      );
    }
    return (
      formatCapacityAdvisory(
        capacityAdvisory(
          selectedResource,
          {
            resourceId,
            startDate,
            endDate: effEndDate,
            hoursPerDay: effHoursPerDay,
            ignoreWeekends,
          },
          others,
          resourceTimeOff,
          selectedEffectiveWeek,
        ),
        "form",
      ) || null
    );
  }, [
    create,
    data.allocations,
    data.timeOff,
    editId,
    effEndDate,
    effHoursPerDay,
    ignoreWeekends,
    isBlocks,
    isExternal,
    repeat,
    repeatProjection,
    resourceId,
    selectedResource,
    selectedEffectiveWeek,
    startDate,
  ]);

  // Guard the formatted end-date hint: effEndDate is derived from a user-typed span, and a
  // value past the date range parses to an Invalid Date, which format() would throw on
  // mid-render (crashing the modal). endDateForSpan already caps the span, so this is
  // belt-and-suspenders — render the hint only when the date is real.
  const parsedEndDate = parseDate(effEndDate);
  const endDateHint = Number.isNaN(parsedEndDate.getTime()) ? null : format(parsedEndDate, "EEE d MMM yyyy");

  // Placeholders and externals are each gated behind a per-account pref (both default OFF). When
  // off, drop them from the assignee picker — EXCEPT the allocation's currently-selected resource
  // (risk A): keep a hidden placeholder/external in the options when it's the one already assigned,
  // so editing shows the correct value in the chooser instead of silently reassigning the work to
  // someone else on save.
  const resourceOptions: Option[] = data.resources
    .filter((r) => placeholdersEnabled || r.kind !== "placeholder" || r.id === resourceId)
    .filter((r) => externalEnabled || !isExternalResource(r) || r.id === resourceId)
    .map((r) => ({
      value: r.id,
      label: `${resourceDisplayName(r)}${
        r.kind === "placeholder"
          ? m.form_allocation_resource_slot_suffix()
          : r.kind === "external"
            ? m.form_allocation_resource_external_suffix()
            : ""
      }`,
    }));
  const clientNameById = new Map(data.clients.map((client) => [client.id, client.name]));
  const sortedProjects = data.projects
    .filter((project) => (lockedProjectId ? project.id === lockedProjectId : true))
    .toSorted((left, right) => {
      const clientOrder = (clientNameById.get(left.clientId) ?? "").localeCompare(
        clientNameById.get(right.clientId) ?? "",
        undefined,
        { sensitivity: "base" },
      );
      return (
        clientOrder ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
        left.id.localeCompare(right.id)
      );
    });
  const projectOptions: Option[] = [
    { value: INTERNAL_PROJECT_SELECTION, label: m.form_allocation_project_internal() },
    { value: ANY_PROJECT_SELECTION, label: m.form_allocation_project_any() },
    ...sortedProjects.map((project, index) => {
      const clientName = clientNameById.get(project.clientId);
      return {
        value: project.id,
        label: clientName ? `${clientName} / ${project.name}` : project.name,
        separatorBefore: index === 0,
      };
    }),
  ];
  const activityScope = activityScopeForProjectSelection(projectSelection);
  const baseActivityOptions = useMemo(
    () =>
      buildActivityOptions(data.activities, data.phases, data.projects, activityScope.kind, activityScope.projectId),
    [activityScope.kind, activityScope.projectId, data.activities, data.phases, data.projects],
  );
  const activityOptions = useMemo(() => {
    if (
      inlineActivityOption &&
      inlineActivityOption.kind === activityScope.kind &&
      inlineActivityOption.projectId === activityScope.projectId &&
      !baseActivityOptions.some((option) => option.value === inlineActivityOption.value)
    ) {
      return [...baseActivityOptions, inlineActivityOption].toSorted(
        (left, right) =>
          left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
          left.value.localeCompare(right.value),
      );
    }
    return baseActivityOptions;
  }, [activityScope.kind, activityScope.projectId, baseActivityOptions, inlineActivityOption]);
  const onAssigneeChange = (v: string) => {
    clear();
    setResourceId(v);
    const r = resourceById.get(v);
    if (r?.kind === "placeholder" && r.projectId) {
      // A placeholder forces its bound project; reset downstream selections.
      setProjectSelection(r.projectId);
      setActivityId("");
    }
  };
  const onProjectChange = (v: string) => {
    clear();
    setProjectSelection(v);
    setActivityId("");
  };
  const onAddActivity = () => {
    if (!canEdit) return;
    const cleanActivityName = validateText(newActivityName, fail, {
      field: "newactivity",
      requiredMessage: m.form_allocation_err_new_activity_name(),
    });
    if (cleanActivityName === null) return;
    try {
      const activity = addActivity({ name: cleanActivityName, ...activityScope });
      // Radix must register a newly inserted item before its controlled value can select it.
      flushSync(() => {
        setInlineActivityOption({
          value: activity.id,
          label: activity.name,
          kind: activity.kind,
          projectId: activity.projectId,
        });
      });
      setActivityId(activity.id);
      setNewActivityName("");
    } catch (error) {
      fail(null, error instanceof Error ? error.message : m.form_allocation_err_save_failed());
    }
  };

  // Save and Duplicate operate on the same visible draft. Keeping validation and effective-value
  // derivation here prevents Duplicate from silently discarding edits or persisting a shape that
  // Save would reject (for example, a historical zero-hour block viewed in Hours mode). The rules
  // themselves live in allocationDraft.ts; this routes the first problem to the offending field and
  // adds the two checks that need the modal's own machinery (the note sanitiser owns `fail`, and the
  // assignment check needs the activity list).
  const validatedDraft = () => {
    const problem = validateAllocationDraft({
      resourceId,
      activityId,
      startDate,
      endDate,
      usesTypedDateRange,
      typedDateSpanTooLong,
      isBlocks,
      isDays,
      isExternal,
      validDaysOver,
      spanFitsDateDomain,
      spanLimitedByDateDomain,
      maximumDaysOver,
      daysOfWork,
      hoursPerDay,
      effHoursPerDay,
      repeat:
        create && repeat !== "none"
          ? { selection: repeat, until: repeatUntil, today: repeatToday, maximum: repeatUntilMaximum }
          : null,
    });
    if (problem) {
      fail(problem.field, problem.message);
      return null;
    }
    const cleanNote = validateText(note, fail, {
      field: "note",
      required: false,
      multiline: !noteEdited,
      maxLength: MAX_NOTE_LENGTH,
    });
    if (cleanNote === null) return null;
    const activity = data.activities.find((act) => act.id === activityId);
    if (selectedResource && activity) {
      const check = validateAllocationAssignment(selectedResource, activity.projectId);
      if (!check.ok) {
        fail("activity", domainErrorMessage(check.codes[0]));
        return null;
      }
    }
    return {
      resourceId,
      activityId,
      startDate,
      endDate: deriveEndDate({
        editing,
        isBlocks,
        isDays,
        resourceId,
        startDate,
        ignoreWeekends,
        daysOver,
        initialDaysOver,
        effectiveEndDate: effEndDate,
      }),
      hoursPerDay: effHoursPerDay,
      status,
      note: cleanNote || undefined,
      // Externals have no working week — weekends are plain calendar days for them, so a span is
      // literal (ignoreWeekends: true) and the toggle is hidden below.
      ignoreWeekends: isExternal ? true : ignoreWeekends,
    };
  };

  const submit = () => {
    if (!canEdit) return;
    const draft = validatedDraft();
    if (!draft) return;
    try {
      if (editing) {
        // Blocks-mode edits deliberately omit hoursPerDay so the store preserves the allocation's
        // historical hourly load; zero load is persisted for a new or duplicated block. Reassigning
        // to an external still writes 0 because that invariant takes precedence over preservation.
        const { hoursPerDay: draftHoursPerDay, ...fields } = draft;
        updateAllocation(editing.id, {
          ...fields,
          ...(!isBlocks || isExternal ? { hoursPerDay: draftHoursPerDay } : {}),
        });
      } else if (repeat === "none") {
        addAllocation(draft);
      } else {
        if (!selectedResource) {
          throw new Error("The selected resource could not be resolved for repeat projection.");
        }
        const { startDates } = generateRepeatingStartDates(
          draft.startDate,
          repeatUntil as ISODate,
          repeatPatternForSelection(repeat),
        );
        const drafts = projectAllocationDates(draft, startDates, {
          schedulingMode: mode,
          daysOver,
          resource: selectedResource,
        });
        const seriesId = newId();
        addAllocations(drafts.map((occurrence) => ({ ...occurrence, seriesId })));
      }
      onClose();
    } catch (e) {
      if (repeat !== "none" && e instanceof RangeError) {
        fail("repeatUntil", m.form_allocation_err_repeat_date_domain());
      } else {
        fail(null, e instanceof Error ? errorMessage(e) : m.form_allocation_err_save_failed());
      }
    }
  };

  const onDuplicate = () => {
    if (!editing) return;
    const draft = validatedDraft();
    if (!draft) return;
    try {
      addAllocation(draft);
      onClose();
    } catch (e) {
      fail(null, e instanceof Error ? errorMessage(e) : m.form_allocation_err_save_failed());
    }
  };

  const onDelete = (scope: "one" | "future" = "one") => {
    if (!editing || !canEdit) return;
    setConfirmDelete(false);
    try {
      if (scope === "future") deleteAllocationSeriesFrom(editing.id);
      else deleteAllocation(editing.id);
    } catch (e) {
      fail(null, e instanceof Error ? errorMessage(e) : m.form_allocation_err_delete_failed());
    }
  };

  // In create mode the assignee is already chosen (the user clicked the + next to
  // their row), so we drop the Assignee select and name them in the title instead.
  const createName = create
    ? initialResource
      ? resourceDisplayName(initialResource)
      : m.form_allocation_advisory_resource_name()
    : undefined;
  const repeatLastStart = repeatProjection?.startDates.at(-1);

  return (
    <Modal
      title={
        editing ? (
          m.form_allocation_edit_title()
        ) : createName ? (
          <>
            {m.form_allocation_new_for({ name: "" })}
            <strong>{createName}</strong>
          </>
        ) : (
          m.form_allocation_new_title()
        )
      }
      onClose={onClose}
      onSubmit={submit}
      onEdit={clear}
      footer={
        <>
          {editing && canEdit && (
            <>
              <Button size="sm" type="button" variant="danger-soft" onClick={() => setConfirmDelete(true)}>
                {m.form_delete()}
              </Button>
              {!editing.seriesId && (
                <Button size="sm" type="button" variant="outline" onClick={onDuplicate}>
                  {m.form_allocation_duplicate()}
                </Button>
              )}
            </>
          )}
          <span className="flex-1" />
          <Button size="sm" type="button" variant="outline" onClick={onClose}>
            {m.form_cancel()}
          </Button>
          {canEdit && (
            <Button size="sm" type="submit">
              {m.form_save()}
            </Button>
          )}
        </>
      }
    >
      {confirmDelete && editing?.seriesId ? (
        <RepeatedAllocationDeleteDialog
          onDeleteOne={() => onDelete("one")}
          onDeleteFuture={() => onDelete("future")}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : confirmDelete ? (
        <ConfirmDialog
          title={m.form_allocation_delete_title()}
          message={m.form_allocation_delete_message({ shortcut: undoShortcut() })}
          onConfirm={() => onDelete("one")}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
      {!create && (
        <SelectField
          label={m.form_allocation_assignee_label()}
          value={resourceId}
          onChange={onAssigneeChange}
          options={resourceOptions}
          placeholder={m.form_allocation_select_resource_placeholder()}
          required
          invalid={errorField === "resource"}
          describedById={errorId}
          layout="label-control"
        />
      )}
      {isPlaceholder && (
        <AllocationControlColumn>
          <p className="text-xs text-muted-foreground">{m.form_allocation_placeholder_locked()}</p>
        </AllocationControlColumn>
      )}

      <SelectField
        label={m.form_allocation_project_label()}
        value={projectSelection}
        onChange={onProjectChange}
        options={projectOptions}
        layout="label-control"
      />
      <SelectField
        label={m.form_allocation_activity_label()}
        value={activityId}
        onChange={setActivityId}
        options={activityOptions}
        placeholder={m.form_allocation_select_activity_placeholder()}
        required
        invalid={errorField === "activity"}
        describedById={errorId}
        layout="label-control"
      />
      {inlineActivityCreateEnabled && canEdit && (
        <AllocationControlColumn>
          <Field orientation="horizontal">
            <Input
              value={newActivityName}
              maxLength={MAX_NAME_INPUT_CODE_UNITS}
              placeholder={
                activityScope.kind === "internal"
                  ? m.form_allocation_new_internal_activity_placeholder()
                  : activityScope.kind === "repeatable"
                    ? m.form_allocation_new_repeatable_activity_placeholder()
                    : m.form_allocation_new_activity_placeholder()
              }
              aria-label={m.form_allocation_new_activity_aria()}
              aria-invalid={errorField === "newactivity" || undefined}
              aria-describedby={errorField === "newactivity" ? errorId : undefined}
              onChange={(e) => setNewActivityName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddActivity();
                }
              }}
            />
            <Button size="sm" type="button" variant="outline" onClick={onAddActivity}>
              <Plus data-icon="inline-start" />
              {m.form_allocation_add_activity()}
            </Button>
          </Field>
        </AllocationControlColumn>
      )}

      {usesTypedDateRange ? (
        <>
          <AllocationControlColumn>
            <DateRangeFields
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
              invalid={errorField === "dates"}
              describedById={errorId}
            />
          </AllocationControlColumn>

          {/* Externals carry no load (hoursPerDay 0), so only the hourly arm asks for one. */}
          {!isExternal && (
            <NumberField
              label={m.form_allocation_hours_per_day_label()}
              value={hoursPerDay}
              onChange={setHoursPerDay}
              min={0}
              max={MAX_HOURS_PER_DAY}
              required
              invalid={errorField === "hours"}
              describedById={errorId}
              layout="label-control"
            />
          )}
        </>
      ) : (
        // Blocks and days are the same span control — a start plus a "days over" count — differing
        // only by the work-volume field days adds, and by whether the derived-end hint also states
        // the rescaled load.
        <AllocationControlColumn>
          <div className={compoundControlsClassName}>
            <DateField
              label={m.form_allocation_start_date_label()}
              value={startDate}
              onChange={setStartDate}
              required
              invalid={errorField === "dates"}
              describedById={errorId}
            />
            {isDays && (
              <NumberField
                label={m.form_allocation_days_of_work_label()}
                value={daysOfWork}
                onChange={setDaysOfWork}
                min={0}
                step={0.5}
                required
                invalid={errorField === "daysOfWork"}
                describedById={errorId}
              />
            )}
            <NumberField
              label={m.form_allocation_days_over_label()}
              value={daysOver}
              onChange={setDaysOver}
              min={1}
              max={maximumDaysOver}
              step={1}
              invalid={errorField === "daysOver"}
              describedById={errorId}
            />
          </div>
          {startDate && endDateHint && (
            <p className="text-xs text-muted-foreground">
              {isDays
                ? m.form_allocation_ends_hint_hours({ date: endDateHint, hours: round2(effHoursPerDay) })
                : m.form_allocation_ends_hint({ date: endDateHint })}
            </p>
          )}
        </AllocationControlColumn>
      )}
      {create && (
        <>
          <SelectField
            label={m.form_allocation_repeat_label()}
            value={repeat}
            onChange={onRepeatChange}
            options={repeatOptions()}
            layout="label-control"
          />
          {repeat !== "none" && (
            <DateField
              label={m.form_allocation_repeat_until_label()}
              value={repeatUntil}
              onChange={onRepeatUntilChange}
              required
              invalid={errorField === "repeatUntil"}
              describedById={errorId}
              min={repeatUntilMinimum}
              max={repeatUntilMaximum}
              layout="label-control"
            />
          )}
          {repeatProjection && repeatLastStart && (
            <AllocationControlColumn>
              <p className="text-xs text-muted-foreground">
                {m.form_allocation_repeat_preview({
                  count: repeatProjection.startDates.length,
                  repeatUntil: formatShortDate(repeatUntil as ISODate),
                  lastStart: formatShortDate(repeatLastStart),
                })}
              </p>
            </AllocationControlColumn>
          )}
        </>
      )}
      <SegmentedField
        label={m.form_allocation_status_label()}
        value={status}
        onChange={setStatus}
        options={allocationStatusOptions()}
        controlClassName="w-full [&>*]:flex-1"
        layout="label-control"
      />
      <TextField
        label={m.form_allocation_note_label()}
        value={note}
        onChange={(value) => {
          setNoteEdited(true);
          setNote(value);
        }}
        maxLength={MAX_NOTE_INPUT_CODE_UNITS}
        invalid={errorField === "note"}
        describedById={errorId}
        layout="label-control"
      />

      {/* Externals have no working pattern — their booking is already a literal start/end span, so
          this checkbox is meaningless and hidden (they store ignoreWeekends: true). */}
      {!isExternal && (
        <CheckboxField
          label={m.form_allocation_ignore_working_days()}
          checked={ignoreWeekends}
          onChange={setIgnoreWeekends}
          layout="label-control"
        />
      )}

      {advisory && (
        <Alert variant="warn" role="status">
          <AlertDescription>{advisory}</AlertDescription>
        </Alert>
      )}
      <FieldError id={errorId} tabIndex={error && errorField === null ? -1 : undefined}>
        {error}
      </FieldError>
      <RequiredLegend />
    </Modal>
  );
}
