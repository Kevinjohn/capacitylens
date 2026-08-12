import { useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { format } from "date-fns";
import { useStore } from "../../store/useStore";
import { useActiveScopedData } from "../../store/useScopedData";
import { daysInclusive, eachDayISO, parseDate, todayISO } from "@capacitylens/shared/lib/dateMath";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import {
  generateRepeatingStartDates,
  defaultRepeatUntilDate,
  maximumRepeatUntilDate,
  RepeatingDateError,
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
  Modal,
  NumberField,
  RequiredLegend,
  SegmentedControl,
  SelectField,
  TextField,
  type Option,
} from "../common/ui";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { FieldError } from "../ui/field";
import { capacityAdvisory, capacityAllocationsForMode, scheduledHoursOnDay } from "../../lib/capacity";
import { allocationStatusLabels, resourceDisplayName } from "../../lib/metadata";
import { FULL_DAY_HOURS, isExternalResource, MAX_HOURS_PER_DAY } from "@capacitylens/shared/types/entities";
import type {
  Activity,
  AllocationStatus,
  ISODate,
  Resource,
  SchedulingMode,
} from "@capacitylens/shared/types/entities";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldLabel } from "../ui/field";
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

/** Snap a seeded days-of-work value to 6 decimals: enough to erase float round-trip
 *  noise (e.g. 8 × 3/7 × 7/8 = 2.9999…) WITHOUT distorting a legitimate fraction
 *  (½ → 0.5, ⅛-day → 1.875). Keeping the seed exact means re-deriving hours on a
 *  no-op save returns the original value rather than drifting it. */
const roundDays = (n: number) => Math.round(n * 1e6) / 1e6;
/** 2-dp rounding for the human-readable "…h/day" hint only — never fed back into a value. */
const round2 = (n: number) => Math.round(n * 100) / 100;

const INTERNAL_PROJECT_SELECTION = "__allocation_internal__";
const ANY_PROJECT_SELECTION = "__allocation_any_project__";

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
  resources: readonly Resource[];
  resourceId: string;
  mode: SchedulingMode;
  startDate: ISODate;
  endDate: ISODate;
  hoursPerDay: number;
  daysOver: number;
  daysOfWork: number;
  ignoreWeekends: boolean;
}

function effectiveAllocationValues({
  resources,
  resourceId,
  mode,
  startDate,
  endDate,
  hoursPerDay,
  daysOver,
  daysOfWork,
  ignoreWeekends,
}: EffectiveAllocationInput) {
  const resource = resources.find((candidate) => candidate.id === resourceId);
  const external = !!resource && isExternalResource(resource);
  const workingHoursPerDay = FULL_DAY_HOURS;
  const validDaysOver = Number.isSafeInteger(daysOver) && daysOver >= 1 && daysOver <= MAX_SPAN_DAYS;
  const spanOpts = { workingDays: resource?.workingDays, ignoreWeekends };
  const maximumDaysOver = startDate ? maxSpanDaysForStart(startDate, spanOpts) : MAX_SPAN_DAYS;
  const spanLimitedByDateDomain = !!startDate && daysInclusive(startDate, "9999-12-31") < MAX_SPAN_DAYS;
  const spanFitsDateDomain = !!startDate && validDaysOver && daysOver <= maximumDaysOver;
  const spanEnd = startDate
    ? endDateForSpan(startDate, validDaysOver && spanFitsDateDomain ? daysOver : 1, spanOpts)
    : endDate;
  const effective = external
    ? { endDate, hoursPerDay: 0 }
    : mode === "blocks"
      ? { endDate: spanEnd, hoursPerDay: blockHoursPerDay(workingHoursPerDay) }
      : mode === "days"
        ? {
            endDate: spanEnd,
            hoursPerDay: hoursPerDayFor(daysOfWork, daysOver, workingHoursPerDay),
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
  const isBlocks = mode === "blocks";

  const editId = "allocationId" in props ? props.allocationId : undefined;
  const create = "create" in props ? props.create : undefined;
  const editing = editId ? data.allocations.find((a) => a.id === editId) : undefined;

  const initialActivity = editing ? data.activities.find((act) => act.id === editing.activityId) : undefined;
  const initialResourceId = editing?.resourceId ?? create?.resourceId ?? "";
  const initialResource = data.resources.find((r) => r.id === initialResourceId);
  const initialLocked = initialResource?.kind === "placeholder" ? initialResource.projectId : undefined;
  const initialWhpd = FULL_DAY_HOURS;
  const initialStart = editing?.startDate ?? create?.startDate ?? todayISO(calendarTimeZone);
  const initialScheduledHours = initialResource ? scheduledHoursOnDay(initialResource, initialStart) : initialWhpd;

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
  const [hoursPerDay, setHoursPerDay] = useState(editing?.hoursPerDay ?? (initialScheduledHours || initialWhpd));
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
  const initialCapacityHours = initialResource
    ? eachDayISO(initialStart, seedEnd ?? initialStart).reduce(
        (sum, day) => sum + scheduledHoursOnDay(initialResource, day),
        0,
      )
    : initialDaysOver * initialWhpd;
  const [daysOfWork, setDaysOfWork] = useState(
    editing
      ? roundDays(daysOfWorkFor(editing.hoursPerDay, initialDaysOver, initialWhpd))
      : roundDays(initialCapacityHours > 0 ? initialCapacityHours / initialWhpd : initialDaysOver),
  );
  const [newActivityName, setNewActivityName] = useState("");
  const [inlineActivityOption, setInlineActivityOption] = useState<
    (Option & { kind: Activity["kind"]; projectId?: string }) | null
  >(null);
  const fieldError = useFieldError();
  const { error, errorField, errorId, fail, clear } = fieldError;
  useFieldErrorFocus(fieldError);
  const ignoreWorkingDaysId = useId();
  const statusLabelId = useId();

  // If the edited allocation is removed out from under us (e.g. undo), close
  // rather than silently turning into a "create" that would resurrect it.
  useEffect(() => {
    if (editId && !editing) onClose();
  }, [editId, editing, onClose]);

  const effectiveValues = useMemo(
    () =>
      effectiveAllocationValues({
        resources: data.resources,
        resourceId,
        mode,
        startDate,
        endDate,
        hoursPerDay,
        daysOver,
        daysOfWork,
        ignoreWeekends,
      }),
    [data.resources, daysOfWork, daysOver, endDate, hoursPerDay, ignoreWeekends, mode, resourceId, startDate],
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
    if (effectiveValues.external) return null;
    // A malformed/reversed span and a range beyond the form's finite work bound get no advisory.
    // This check is O(1) and runs before capacityAdvisory can materialise one ISO string per day.
    const span = startDate && effectiveValues.endDate ? daysInclusive(startDate, effectiveValues.endDate) : 0;
    if (!effectiveValues.resource || !startDate || !effectiveValues.endDate || span < 1 || span > MAX_SPAN_DAYS)
      return null;
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
      const { overCapacityAllocations, timeOffAllocations } = repeatingAllocationAdvisory(
        effectiveValues.resource,
        others,
        resourceTimeOff,
        repeatProjection.drafts,
      );
      const bits: string[] = [];
      if (overCapacityAllocations)
        bits.push(
          overCapacityAllocations === 1
            ? m.form_allocation_repeat_advisory_over_capacity_one({ count: overCapacityAllocations })
            : m.form_allocation_repeat_advisory_over_capacity_other({ count: overCapacityAllocations }),
        );
      if (timeOffAllocations)
        bits.push(
          timeOffAllocations === 1
            ? m.form_allocation_repeat_advisory_timeoff_one({ count: timeOffAllocations })
            : m.form_allocation_repeat_advisory_timeoff_other({ count: timeOffAllocations }),
        );
      return bits.length
        ? m.form_allocation_repeat_advisory({
            advisory: bits.join(m.form_allocation_repeat_advisory_join()),
          })
        : null;
    }
    const { overDays, timeOffDays } = capacityAdvisory(
      effectiveValues.resource,
      others,
      resourceTimeOff,
      startDate,
      effectiveValues.endDate,
      effectiveValues.hoursPerDay,
      ignoreWeekends,
    );
    const bits: string[] = [];
    if (overDays)
      bits.push(
        overDays === 1
          ? m.form_allocation_advisory_over_capacity_one({ count: overDays })
          : m.form_allocation_advisory_over_capacity_other({ count: overDays }),
      );
    if (timeOffDays)
      bits.push(
        timeOffDays === 1
          ? m.form_allocation_advisory_timeoff_one({ count: timeOffDays })
          : m.form_allocation_advisory_timeoff_other({ count: timeOffDays }),
      );
    return bits.length ? m.form_allocation_advisory({ advisory: bits.join(m.form_allocation_advisory_join()) }) : null;
  }, [
    create,
    data.allocations,
    data.timeOff,
    editId,
    effectiveValues,
    ignoreWeekends,
    isBlocks,
    repeat,
    repeatProjection,
    resourceId,
    startDate,
  ]);

  // Guard the formatted end-date hint: effEndDate is derived from a user-typed span, and a
  // value past the date range parses to an Invalid Date, which format() would throw on
  // mid-render (crashing the modal). endDateForSpan already caps the span, so this is
  // belt-and-suspenders — render the hint only when the date is real.
  const endDateHint = (() => {
    const d = parseDate(effEndDate);
    return Number.isNaN(d.getTime()) ? null : format(d, "EEE d MMM yyyy");
  })();

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
    const r = data.resources.find((x) => x.id === v);
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
  // Save would reject (for example, a historical zero-hour block viewed in Hours mode).
  const validatedDraft = () => {
    if (!resourceId) {
      fail("resource", m.form_allocation_err_choose_resource());
      return null;
    }
    if (!activityId) {
      fail("activity", m.form_allocation_err_choose_activity());
      return null;
    }
    const usesTypedDateRange = isExternal || (!isBlocks && !isDays);
    if (usesTypedDateRange) {
      // External and hourly allocations both use the raw Start/End inputs. Validate this once so
      // neither mode can persist a range the advisory deliberately refuses to enumerate.
      if (!startDate || !endDate) {
        fail("dates", m.form_allocation_err_dates_required());
        return null;
      }
      if (endDate < startDate) {
        fail("dates", m.form_allocation_err_end_before_start());
        return null;
      }
      if (typedDateSpanTooLong) {
        fail(
          "dates",
          m.form_allocation_err_date_span_range({
            max: MAX_SPAN_DAYS.toLocaleString("en-GB"),
          }),
        );
        return null;
      }
    }
    if (isBlocks) {
      if (!startDate) {
        fail("dates", m.form_allocation_err_start_required());
        return null;
      }
      if (!validDaysOver) {
        fail("daysOver", m.form_allocation_err_days_over_range({ max: MAX_SPAN_DAYS }));
        return null;
      }
      if (!spanFitsDateDomain) {
        fail(
          "daysOver",
          spanLimitedByDateDomain
            ? m.form_allocation_err_days_over_date_domain()
            : m.form_allocation_err_days_over_range({ max: maximumDaysOver }),
        );
        return null;
      }
    } else if (isDays) {
      if (!startDate) {
        fail("dates", m.form_allocation_err_start_required());
        return null;
      }
      if (!validDaysOver) {
        fail("daysOver", m.form_allocation_err_days_over_range({ max: MAX_SPAN_DAYS }));
        return null;
      }
      if (!spanFitsDateDomain) {
        fail(
          "daysOver",
          spanLimitedByDateDomain
            ? m.form_allocation_err_days_over_date_domain()
            : m.form_allocation_err_days_over_range({ max: maximumDaysOver }),
        );
        return null;
      }
      if (!(daysOfWork > 0)) {
        fail("daysOfWork", m.form_allocation_err_days_of_work_gt_zero());
        return null;
      }
    } else if (!isExternal) {
      if (!(hoursPerDay > 0)) {
        fail("hours", m.form_allocation_err_hours_gt_zero());
        return null;
      }
    }
    if (create && repeat !== "none") {
      if (!repeatUntil || !isValidISODate(repeatUntil)) {
        fail("repeatUntil", m.form_allocation_err_repeat_until_required());
        return null;
      }
      if (repeatUntil < repeatToday) {
        fail("repeatUntil", m.form_allocation_err_repeat_until_past());
        return null;
      }
      if (repeatUntil < startDate) {
        fail("repeatUntil", m.form_allocation_err_repeat_until_before_start());
        return null;
      }
      if (!repeatUntilMaximum) {
        fail("repeatUntil", m.form_allocation_err_repeat_date_domain());
        return null;
      }
      if (repeatUntil > repeatUntilMaximum) {
        fail(
          "repeatUntil",
          m.form_allocation_err_repeat_until_after_max({
            max: formatShortDate(repeatUntilMaximum),
          }),
        );
        return null;
      }
      try {
        generateRepeatingStartDates(startDate, repeatUntil, repeatPatternForSelection(repeat));
      } catch (error) {
        if (error instanceof RepeatingDateError) {
          fail(
            "repeatUntil",
            error.code === "no-repeat"
              ? m.form_allocation_err_repeat_until_no_occurrence()
              : m.form_allocation_err_repeat_date_domain(),
          );
        } else {
          fail(null, error instanceof Error ? errorMessage(error) : m.form_allocation_err_save_failed());
        }
        return null;
      }
    }
    // Single anti-silent-clamp guard for every load-carrying mode (days + hourly; external is a
    // 0-load span and blocks derive a safe block load, so both are excluded). The store clamps an
    // allocation's load into [0, MAX_HOURS_PER_DAY] AND collapses a non-finite value to 0 — so a
    // derived load that's NaN (a part-typed "Days over" → hoursPerDayFor returns NaN) or above the
    // cap (an Enter-submit before the field's on-blur clamp) would SILENTLY save the wrong volume.
    // Require a finite load in (0, MAX_HOURS_PER_DAY] instead, so the preview ("…h/day") is exactly
    // what saves, failing to the field the user can act on in each mode.
    if (
      !isExternal &&
      !isBlocks &&
      !(Number.isFinite(effHoursPerDay) && effHoursPerDay > 0 && effHoursPerDay <= MAX_HOURS_PER_DAY)
    ) {
      if (isDays) {
        fail("daysOfWork", m.form_allocation_err_days_over_max({ max: MAX_HOURS_PER_DAY }));
      } else {
        fail("hours", m.form_allocation_err_hours_over_max({ max: MAX_HOURS_PER_DAY }));
      }
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
    // Externals have no working week — weekends are plain calendar days for them, so a span is
    // literal (ignoreWeekends: true) and the toggle is hidden below.
    const preserveStoredEnd =
      editing !== undefined &&
      (isDays || isBlocks) &&
      resourceId === editing.resourceId &&
      startDate === editing.startDate &&
      ignoreWeekends === (editing.ignoreWeekends ?? false) &&
      daysOver === initialDaysOver;
    return {
      resourceId,
      activityId,
      startDate,
      endDate: preserveStoredEnd ? editing.endDate : effEndDate,
      hoursPerDay: effHoursPerDay,
      status,
      note: cleanNote ? cleanNote : undefined,
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
        />
      )}
      {isPlaceholder && <p className="text-xs text-muted-foreground">{m.form_allocation_placeholder_locked()}</p>}

      <SelectField
        label={m.form_allocation_project_label()}
        value={projectSelection}
        onChange={onProjectChange}
        options={projectOptions}
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
      />
      {inlineActivityCreateEnabled && canEdit && (
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
      )}

      {isExternal ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <DateField
              label={m.form_allocation_start_date_label()}
              value={startDate}
              onChange={setStartDate}
              required
              invalid={errorField === "dates"}
              describedById={errorId}
            />
          </div>
          <div className="flex-1">
            <DateField
              label={m.form_allocation_end_label()}
              value={endDate}
              onChange={setEndDate}
              required
              invalid={errorField === "dates"}
              describedById={errorId}
            />
          </div>
        </div>
      ) : isBlocks ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField
                label={m.form_allocation_start_date_label()}
                value={startDate}
                onChange={setStartDate}
                required
                invalid={errorField === "dates"}
                describedById={errorId}
              />
            </div>
            <div className="flex-1">
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
          </div>
          {startDate && endDateHint && (
            <p className="text-xs text-muted-foreground">{m.form_allocation_ends_hint({ date: endDateHint })}</p>
          )}
        </>
      ) : isDays ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField
                label={m.form_allocation_start_date_label()}
                value={startDate}
                onChange={setStartDate}
                required
                invalid={errorField === "dates"}
                describedById={errorId}
              />
            </div>
            <div className="flex-1">
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
            </div>
            <div className="flex-1">
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
          </div>
          {startDate && endDateHint && (
            <p className="text-xs text-muted-foreground">
              {m.form_allocation_ends_hint_hours({
                date: endDateHint,
                hours: round2(effHoursPerDay),
              })}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField
                label={m.form_allocation_start_date_label()}
                value={startDate}
                onChange={setStartDate}
                required
                invalid={errorField === "dates"}
                describedById={errorId}
              />
            </div>
            <div className="flex-1">
              <DateField
                label={m.form_allocation_end_label()}
                value={endDate}
                onChange={setEndDate}
                required
                invalid={errorField === "dates"}
                describedById={errorId}
              />
            </div>
          </div>

          <NumberField
            label={m.form_allocation_hours_per_day_label()}
            value={hoursPerDay}
            onChange={setHoursPerDay}
            min={0}
            max={MAX_HOURS_PER_DAY}
            required
            invalid={errorField === "hours"}
            describedById={errorId}
          />
        </>
      )}
      {create && (
        <>
          <SelectField
            label={m.form_allocation_repeat_label()}
            value={repeat}
            onChange={onRepeatChange}
            options={repeatOptions()}
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
            />
          )}
          {repeatProjection && repeatLastStart && (
            <p className="text-xs text-muted-foreground">
              {m.form_allocation_repeat_preview({
                count: repeatProjection.startDates.length,
                repeatUntil: formatShortDate(repeatUntil as ISODate),
                lastStart: formatShortDate(repeatLastStart),
              })}
            </p>
          )}
        </>
      )}
      <Field>
        <FieldLabel id={statusLabelId}>{m.form_allocation_status_label()}</FieldLabel>
        <SegmentedControl
          value={status}
          onChange={setStatus}
          options={Object.entries(allocationStatusLabels()).map(([value, label]) => ({
            value: value as AllocationStatus,
            label,
          }))}
          ariaLabelledby={statusLabelId}
          className="w-full [&>*]:flex-1"
        />
      </Field>
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
      />

      {/* Externals have no working pattern — their booking is already a literal start/end span, so
          this checkbox is meaningless and hidden (they store ignoreWeekends: true). */}
      {!isExternal && (
        <Field orientation="horizontal">
          <Checkbox
            id={ignoreWorkingDaysId}
            checked={ignoreWeekends}
            onCheckedChange={(checked) => setIgnoreWeekends(checked === true)}
          />
          <FieldLabel htmlFor={ignoreWorkingDaysId}>{m.form_allocation_ignore_working_days()}</FieldLabel>
        </Field>
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
