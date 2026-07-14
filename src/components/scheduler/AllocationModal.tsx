import { useEffect, useId, useState } from 'react'
import { format } from 'date-fns'
import { useStore } from '../../store/useStore'
import { useActiveScopedData } from '../../store/useScopedData'
import { parseDate, todayISO } from '@capacitylens/shared/lib/dateMath'
import { blockHoursPerDay, daysOfWorkFor, endDateForSpan, hoursPerDayFor, MAX_SPAN_DAYS, spanDays } from '@capacitylens/shared/lib/schedulingDays'
import { externalEnabledFor, placeholdersEnabledFor, schedulingModeFor } from '../../store/selectors'
import { validateAllocationAssignment } from '@capacitylens/shared/lib/integrity'
import { validateText } from '../../lib/validation'
import { m } from '@/i18n'
import { MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings'
import {
  AddButton,
  Button,
  Callout,
  DateField,
  FieldError,
  Modal,
  NumberField,
  RequiredLegend,
  SelectField,
  TextAreaField,
  type Option,
} from '../common/ui'
import { inputClass } from '../common/controls'
import { capacityAdvisory } from '../../lib/capacity'
import { allocationStatusOptions, resourceDisplayName } from '../../lib/metadata'
import { isExternalResource, MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities'
import type { AllocationStatus, ISODate } from '@capacitylens/shared/types/entities'

/** Snap a seeded days-of-work value to 6 decimals: enough to erase float round-trip
 *  noise (e.g. 8 × 3/7 × 7/8 = 2.9999…) WITHOUT distorting a legitimate fraction
 *  (½ → 0.5, ⅛-day → 1.875). Keeping the seed exact means re-deriving hours on a
 *  no-op save returns the original value rather than drifting it. */
const roundDays = (n: number) => Math.round(n * 1e6) / 1e6
/** 2-dp rounding for the human-readable "…h/day" hint only — never fed back into a value. */
const round2 = (n: number) => Math.round(n * 100) / 100

type AllocationModalProps =
  | { allocationId: string; onClose: () => void }
  | { create: { resourceId: string; startDate: ISODate; endDate: ISODate }; onClose: () => void }

export function AllocationModal(props: AllocationModalProps) {
  const { onClose } = props
  const data = useActiveScopedData()
  const addAllocation = useStore((s) => s.addAllocation)
  const updateAllocation = useStore((s) => s.updateAllocation)
  const deleteAllocation = useStore((s) => s.deleteAllocation)
  const addActivity = useStore((s) => s.addActivity)
  const mode = useStore((s) => schedulingModeFor(s.data, s.activeAccountId))
  // Per-account view pref (default OFF): when off, placeholders are dropped from the assignee
  // picker (except an already-assigned one — see resourceOptions below for risk A).
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId))
  // Per-account view pref (default OFF): when off, external / 3rd parties are dropped from the
  // assignee picker (except an already-assigned one — same risk-A escape hatch as placeholders).
  const externalEnabled = useStore((s) => externalEnabledFor(s.data, s.activeAccountId))
  const calendarTimeZone = useStore((s) => s.data.accounts.find((a) => a.id === s.activeAccountId)?.timezone ?? 'Etc/GMT')
  const isDays = mode === 'days'
  const isBlocks = mode === 'blocks'

  const editId = 'allocationId' in props ? props.allocationId : undefined
  const create = 'create' in props ? props.create : undefined
  const editing = editId ? data.allocations.find((a) => a.id === editId) : undefined

  const initialActivity = editing ? data.activities.find((act) => act.id === editing.activityId) : undefined
  const initialResourceId = editing?.resourceId ?? create?.resourceId ?? ''
  const initialResource = data.resources.find((r) => r.id === initialResourceId)
  const initialLocked = initialResource?.kind === 'placeholder' ? initialResource.projectId : undefined

  const [resourceId, setResourceId] = useState(initialResourceId)
  // When editing, the existing activity's project wins (undefined → '' = general), so a
  // placeholder→general allocation reopens with the Activity select correctly populated.
  // `initialLocked` is only the CREATE-time default for a placeholder's bound project.
  const [projectId, setProjectId] = useState(editing ? (initialActivity?.projectId ?? '') : (initialLocked ?? ''))
  const [activityId, setActivityId] = useState(editing?.activityId ?? '')
  const [startDate, setStartDate] = useState<ISODate>(editing?.startDate ?? create?.startDate ?? todayISO(calendarTimeZone))
  const [endDate, setEndDate] = useState<ISODate>(editing?.endDate ?? create?.endDate ?? todayISO(calendarTimeZone))
  const [hoursPerDay, setHoursPerDay] = useState(editing?.hoursPerDay ?? initialResource?.workingHoursPerDay ?? 8)
  const [status, setStatus] = useState<AllocationStatus>(editing?.status ?? 'confirmed')
  const [note, setNote] = useState(editing?.note ?? '')
  const [ignoreWeekends, setIgnoreWeekends] = useState(editing?.ignoreWeekends ?? false)
  // Days-mode inputs (used only when isDays). For an EXISTING allocation we invert
  // hours/dates against the assignee's working week; for a NEW one we honour the span
  // the user drew on the lane (start..end) at full-time load, mirroring how hourly
  // create defaults hours to a full working day across the same range.
  const initialWhpd = initialResource?.workingHoursPerDay ?? 8
  const initialStart = editing?.startDate ?? create?.startDate ?? todayISO(calendarTimeZone)
  const seedEnd = editing?.endDate ?? create?.endDate
  const initialDaysOpts = { workingDays: initialResource?.workingDays, ignoreWeekends: editing?.ignoreWeekends ?? false }
  const initialDaysOver = seedEnd ? Math.max(1, spanDays(initialStart, seedEnd, initialDaysOpts)) : 1
  // NumberField can expose a transient 0 while the user clears the number input. Submission below
  // validates daysOver explicitly; the defensive 1 used for the live preview is never persisted.
  const [daysOver, setDaysOver] = useState(initialDaysOver)
  const [daysOfWork, setDaysOfWork] = useState(
    editing ? roundDays(daysOfWorkFor(editing.hoursPerDay, initialDaysOver, initialWhpd)) : initialDaysOver,
  )
  const [newActivityName, setNewActivityName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
  const fail = (field: string | null, message: string) => {
    setError(message)
    setErrorField(field)
  }

  // If the edited allocation is removed out from under us (e.g. undo), close
  // rather than silently turning into a "create" that would resurrect it.
  useEffect(() => {
    if (editId && !editing) onClose()
  }, [editId, editing, onClose])

  const selectedResource = data.resources.find((r) => r.id === resourceId)
  const isPlaceholder = selectedResource?.kind === 'placeholder'
  // External / 3rd-party assignees carry no hours: the modal collects just a date span and
  // persists hoursPerDay 0 (like a 'blocks' booking), with no capacity advisory.
  const isExternal = !!selectedResource && isExternalResource(selectedResource)
  const lockedProjectId = isPlaceholder ? selectedResource?.projectId : undefined

  // Effective range/hours fed to the capacity check and the store. In days mode the
  // end date and hours/day are DERIVED from (start, days of work, days over) against
  // the assignee's working week; in hourly mode the typed fields are used as-is.
  const workingHoursPerDay = selectedResource?.workingHoursPerDay ?? initialWhpd
  const daysOpts = { workingDays: selectedResource?.workingDays, ignoreWeekends }
  // Effective end date + hours from the assignee kind + the account's scheduling mode:
  //   external → a plain typed start/end span, no load (hoursPerDay 0);
  //   blocks   → a (start, days-over) span, no load (0);
  //   days     → a (start, days-over) span, hours rescaled to fit the work volume;
  //   hourly   → the typed end + hours as-is.
  const validDaysOver = Number.isSafeInteger(daysOver) && daysOver >= 1 && daysOver <= MAX_SPAN_DAYS
  const spanEnd = startDate ? endDateForSpan(startDate, validDaysOver ? daysOver : 1, daysOpts) : endDate
  const { endDate: effEndDate, hoursPerDay: effHoursPerDay } = isExternal
    ? { endDate, hoursPerDay: 0 }
    : isBlocks
      ? { endDate: spanEnd, hoursPerDay: blockHoursPerDay(workingHoursPerDay) }
      : isDays
        ? { endDate: spanEnd, hoursPerDay: hoursPerDayFor(daysOfWork, daysOver, workingHoursPerDay) }
        : { endDate, hoursPerDay }
  // Guard the formatted end-date hint: effEndDate is derived from a user-typed span, and a
  // value past the date range parses to an Invalid Date, which format() would throw on
  // mid-render (crashing the modal). endDateForSpan already caps the span, so this is
  // belt-and-suspenders — render the hint only when the date is real.
  const endDateHint = (() => {
    const d = parseDate(effEndDate)
    return Number.isNaN(d.getTime()) ? null : format(d, 'EEE d MMM yyyy')
  })()

  // Placeholders and externals are each gated behind a per-account pref (both default OFF). When
  // off, drop them from the assignee picker — EXCEPT the allocation's currently-selected resource
  // (risk A): keep a hidden placeholder/external in the options when it's the one already assigned,
  // so editing shows the correct value in the <select> instead of silently reassigning the work to
  // someone else on save.
  const resourceOptions: Option[] = data.resources
    .filter((r) => placeholdersEnabled || r.kind !== 'placeholder' || r.id === resourceId)
    .filter((r) => externalEnabled || !isExternalResource(r) || r.id === resourceId)
    .map((r) => ({
      value: r.id,
      label: `${resourceDisplayName(r)}${
        r.kind === 'placeholder'
          ? m.form_allocation_resource_slot_suffix()
          : r.kind === 'external'
            ? m.form_allocation_resource_external_suffix()
            : ''
      }`,
    }))
  // "No project" lets you pick project-less activities (internal + repeatable). A placeholder is
  // offered only its bound project plus this option (it can take project-less activities too).
  const projectOptions: Option[] = [
    { value: '', label: m.form_no_project_internal_repeatable() },
    ...data.projects
      .filter((p) => (lockedProjectId ? p.id === lockedProjectId : true))
      .map((p) => {
        const client = data.clients.find((c) => c.id === p.clientId)
        return { value: p.id, label: client ? `${client.name} / ${p.name}` : p.name }
      }),
  ]
  const activityOptions: Option[] = data.activities
    .filter((t) => (projectId ? t.projectId === projectId : !t.projectId))
    .map((t) => ({ value: t.id, label: t.name }))

  const onAssigneeChange = (v: string) => {
    setResourceId(v)
    const r = data.resources.find((x) => x.id === v)
    if (r?.kind === 'placeholder' && r.projectId) {
      // A placeholder forces its bound project; reset downstream selections.
      setProjectId(r.projectId)
      setActivityId('')
    }
  }
  const onProjectChange = (v: string) => {
    setProjectId(v)
    setActivityId('')
  }
  const onAddActivity = () => {
    // No project selected → create a project-less, repeatable activity; otherwise a project activity
    // bound to the chosen project. Was a silent no-op on a blank name — give feedback.
    const cleanActivityName = validateText(newActivityName, fail, {
      field: 'newactivity',
      requiredMessage: m.form_allocation_err_new_activity_name(),
    })
    if (cleanActivityName === null) return
    const activity = projectId
      ? addActivity({ name: cleanActivityName, kind: 'project', projectId })
      : addActivity({ name: cleanActivityName, kind: 'repeatable' })
    setActivityId(activity.id)
    setNewActivityName('')
  }

  const submit = () => {
    if (!resourceId) {
      fail('resource', m.form_allocation_err_choose_resource())
      return
    }
    if (!activityId) {
      fail('activity', m.form_allocation_err_choose_activity())
      return
    }
    if (isExternal) {
      // External is a plain span: start + end, no hours (hoursPerDay persists as 0).
      if (!startDate || !endDate) {
        fail('dates', m.form_allocation_err_dates_required())
        return
      }
      if (endDate < startDate) {
        fail('dates', m.form_allocation_err_end_before_start())
        return
      }
    } else if (isBlocks) {
      if (!startDate) {
        fail('dates', m.form_allocation_err_start_required())
        return
      }
      if (!validDaysOver) {
        fail('daysOver', m.form_allocation_err_days_over_range({ max: MAX_SPAN_DAYS }))
        return
      }
    } else if (isDays) {
      if (!startDate) {
        fail('dates', m.form_allocation_err_start_required())
        return
      }
      if (!validDaysOver) {
        fail('daysOver', m.form_allocation_err_days_over_range({ max: MAX_SPAN_DAYS }))
        return
      }
      if (!(daysOfWork > 0)) {
        fail('daysOfWork', m.form_allocation_err_days_of_work_gt_zero())
        return
      }
    } else {
      if (!startDate || !endDate) {
        fail('dates', m.form_allocation_err_dates_required())
        return
      }
      if (endDate < startDate) {
        fail('dates', m.form_allocation_err_end_before_start())
        return
      }
      if (!(hoursPerDay > 0)) {
        fail('hours', m.form_allocation_err_hours_gt_zero())
        return
      }
    }
    // Single anti-silent-clamp guard for every load-carrying mode (days + hourly; external is a
    // 0-load span and blocks derive a safe block load, so both are excluded). The store clamps an
    // allocation's load into [0, MAX_HOURS_PER_DAY] AND collapses a non-finite value to 0 — so a
    // derived load that's NaN (a part-typed "Days over" → hoursPerDayFor returns NaN) or above the
    // cap (an Enter-submit before the field's on-blur clamp) would SILENTLY save the wrong volume.
    // Require a finite load in (0, MAX_HOURS_PER_DAY] instead, so the preview ("…h/day") is exactly
    // what saves, failing to the field the user can act on in each mode.
    if (!isExternal && !isBlocks && !(Number.isFinite(effHoursPerDay) && effHoursPerDay > 0 && effHoursPerDay <= MAX_HOURS_PER_DAY)) {
      if (isDays) {
        fail('daysOfWork', m.form_allocation_err_days_over_max({ max: MAX_HOURS_PER_DAY }))
      } else {
        fail('hours', m.form_allocation_err_hours_over_max({ max: MAX_HOURS_PER_DAY }))
      }
      return
    }
    const cleanNote = validateText(note, fail, { field: 'note', required: false, multiline: true })
    if (cleanNote === null) return
    const activity = data.activities.find((act) => act.id === activityId)
    if (selectedResource && activity) {
      const check = validateAllocationAssignment(selectedResource, activity.projectId)
      if (!check.ok) {
        fail('activity', check.errors[0])
        return
      }
    }
    // Both modes persist the same shape; days mode just feeds the DERIVED end/hours.
    // Externals have no working week — weekends are plain calendar days for them, so a span is
    // literal (ignoreWeekends: true) and the toggle is hidden below.
    const fields = { activityId, startDate, endDate: effEndDate, hoursPerDay: effHoursPerDay, status, note: cleanNote ? cleanNote : undefined, ignoreWeekends: isExternal ? true : ignoreWeekends }
    try {
      if (editing) updateAllocation(editing.id, { resourceId, ...fields })
      else addAllocation({ resourceId, ...fields })
      onClose()
    } catch (e) {
      fail(null, e instanceof Error ? e.message : m.form_allocation_err_save_failed())
    }
  }

  const onDuplicate = () => {
    if (!editing) return
    // Run the copied note through the same validator as Save, for symmetry: an existing note is
    // already clean, but this keeps the one note-handling rule in ONE place (a future paste-edited
    // or imported note can't slip an over-long / junk value past the duplicate path).
    const cleanNote = validateText(editing.note ?? '', fail, { field: 'note', required: false, multiline: true })
    if (cleanNote === null) return
    try {
      addAllocation({
        resourceId: editing.resourceId,
        activityId: editing.activityId,
        startDate: editing.startDate,
        endDate: editing.endDate,
        hoursPerDay: editing.hoursPerDay,
        status: editing.status,
        note: cleanNote ? cleanNote : undefined,
        ignoreWeekends: editing.ignoreWeekends,
      })
      onClose()
    } catch (e) {
      fail(null, e instanceof Error ? e.message : m.form_allocation_err_save_failed())
    }
  }

  // In create mode the assignee is already chosen (the user clicked the + next to
  // their row), so we drop the Assignee select and name them in the title instead.
  const createName = create ? (initialResource ? resourceDisplayName(initialResource) : m.form_allocation_advisory_resource_name()) : undefined

  // Non-blocking capacity advisory (DECISIONS.md: "advisory at allocation time"). The drag-move
  // path shows this as a post-commit toast; surface it HERE too — on the create/edit surface that
  // every keyboard user and every "+"-create reaches. Saving stays allowed (advisory, never a block).
  const advisory = (() => {
    // External parties have no capacity — never show an over-capacity / time-off advisory.
    if (isExternal) return null
    if (!selectedResource || !startDate || !effEndDate) return null
    const others = data.allocations.filter((a) => a.resourceId === resourceId && a.id !== editId)
    const resourceTimeOff = data.timeOff.filter((t) => t.resourceId === resourceId)
    const { overDays, timeOffDays } = capacityAdvisory(selectedResource, others, resourceTimeOff, startDate, effEndDate, effHoursPerDay, ignoreWeekends)
    const bits: string[] = []
    if (overDays)
      bits.push(
        overDays === 1
          ? m.form_allocation_advisory_over_capacity_one({ count: overDays })
          : m.form_allocation_advisory_over_capacity_other({ count: overDays }),
      )
    if (timeOffDays)
      bits.push(
        timeOffDays === 1
          ? m.form_allocation_advisory_timeoff_one({ count: timeOffDays })
          : m.form_allocation_advisory_timeoff_other({ count: timeOffDays }),
      )
    return bits.length ? bits.join(m.form_allocation_advisory_join()) : null
  })()

  return (
    <Modal
      title={
        editing ? (
          m.form_allocation_edit_title()
        ) : createName ? (
          <>{m.form_allocation_new_for({ name: '' })}<strong>{createName}</strong></>
        ) : (
          m.form_allocation_new_title()
        )
      }
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {editing && (
            <>
              <Button variant="danger" onClick={() => { deleteAllocation(editing.id); onClose() }}>
                {m.form_delete()}
              </Button>
              <Button variant="ghost" onClick={onDuplicate}>
                {m.form_allocation_duplicate()}
              </Button>
            </>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            {m.form_cancel()}
          </Button>
          <Button type="submit">{m.form_save()}</Button>
        </>
      }
    >
      <RequiredLegend />
      {!create && (
        <SelectField label={m.form_allocation_assignee_label()} value={resourceId} onChange={onAssigneeChange} options={resourceOptions} placeholder={m.form_allocation_select_resource_placeholder()} required invalid={errorField === 'resource'} describedById={errorId} />
      )}
      {isPlaceholder && <p className="text-xs text-muted">{m.form_allocation_placeholder_locked()}</p>}

      <SelectField
        label={m.form_allocation_project_label()}
        value={projectId}
        onChange={onProjectChange}
        options={projectOptions}
      />
      <SelectField label={m.form_allocation_activity_label()} value={activityId} onChange={setActivityId} options={activityOptions} placeholder={m.form_allocation_select_activity_placeholder()} required invalid={errorField === 'activity'} describedById={errorId} />
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={newActivityName}
          maxLength={MAX_NAME_LENGTH}
          placeholder={projectId ? m.form_allocation_new_activity_placeholder() : m.form_allocation_new_repeatable_activity_placeholder()}
          aria-label={m.form_allocation_new_activity_aria()}
          aria-invalid={errorField === 'newactivity' || undefined}
          onChange={(e) => setNewActivityName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddActivity() } }}
        />
        <AddButton label={m.form_allocation_add_activity()} variant="ghost" onClick={onAddActivity} />
      </div>

      {isExternal ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <DateField label={m.form_allocation_start_date_label()} value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
          </div>
          <div className="flex-1">
            <DateField label={m.form_allocation_end_label()} value={endDate} onChange={setEndDate} required invalid={errorField === 'dates'} describedById={errorId} />
          </div>
        </div>
      ) : isBlocks ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField label={m.form_allocation_start_date_label()} value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <NumberField label={m.form_allocation_days_over_label()} value={daysOver} onChange={setDaysOver} min={1} max={MAX_SPAN_DAYS} step={1} invalid={errorField === 'daysOver'} describedById={errorId} />
            </div>
          </div>
          {startDate && endDateHint && (
            <p className="text-xs text-muted">{m.form_allocation_ends_hint({ date: endDateHint })}</p>
          )}
        </>
      ) : isDays ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField label={m.form_allocation_start_date_label()} value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <NumberField label={m.form_allocation_days_of_work_label()} value={daysOfWork} onChange={setDaysOfWork} min={0} step={0.5} required invalid={errorField === 'daysOfWork'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <NumberField label={m.form_allocation_days_over_label()} value={daysOver} onChange={setDaysOver} min={1} max={MAX_SPAN_DAYS} step={1} invalid={errorField === 'daysOver'} describedById={errorId} />
            </div>
          </div>
          {startDate && endDateHint && (
            <p className="text-xs text-muted">{m.form_allocation_ends_hint_hours({ date: endDateHint, hours: round2(effHoursPerDay) })}</p>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField label={m.form_allocation_start_date_label()} value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <DateField label={m.form_allocation_end_label()} value={endDate} onChange={setEndDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
          </div>

          <NumberField label={m.form_allocation_hours_per_day_label()} value={hoursPerDay} onChange={setHoursPerDay} min={0} max={MAX_HOURS_PER_DAY} required invalid={errorField === 'hours'} describedById={errorId} />
        </>
      )}
      <SelectField label={m.form_allocation_status_label()} value={status} onChange={(v) => setStatus(v as AllocationStatus)} options={allocationStatusOptions()} />
      <TextAreaField label={m.form_allocation_note_label()} value={note} onChange={setNote} invalid={errorField === 'note'} describedById={errorId} />

      {/* Externals have no working week — their booking is a literal start/end span, so the weekend
          toggle is meaningless and hidden (they store ignoreWeekends: true). */}
      {!isExternal && (
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="rounded border-line"
            checked={ignoreWeekends}
            onChange={(e) => setIgnoreWeekends(e.target.checked)}
          />
          <span>{m.form_allocation_include_weekends()}</span>
        </label>
      )}

      {advisory && <Callout>{m.form_allocation_advisory({ advisory })}</Callout>}
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
