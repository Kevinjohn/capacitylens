import { useEffect, useId, useState } from 'react'
import { format } from 'date-fns'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
import { parseDate, todayISO } from '@floaty/shared/lib/dateMath'
import { blockHoursPerDay, daysOfWorkFor, endDateForSpan, hoursPerDayFor, MAX_SPAN_DAYS, spanDays } from '@floaty/shared/lib/schedulingDays'
import { schedulingModeFor } from '../../store/selectors'
import { validateAllocationAssignment } from '@floaty/shared/lib/integrity'
import { validateText } from '../../lib/validation'
import { MAX_NAME_LENGTH } from '@floaty/shared/lib/strings'
import {
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
import { ALLOCATION_STATUS_OPTIONS, resourceDisplayName } from '../../lib/metadata'
import { isExternalResource } from '@floaty/shared/types/entities'
import type { AllocationStatus, ISODate } from '@floaty/shared/types/entities'

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
  const data = useScopedData()
  const addAllocation = useStore((s) => s.addAllocation)
  const updateAllocation = useStore((s) => s.updateAllocation)
  const deleteAllocation = useStore((s) => s.deleteAllocation)
  const addActivity = useStore((s) => s.addActivity)
  const mode = useStore((s) => schedulingModeFor(s.data, s.activeAccountId))
  // Device-global view pref (default OFF): when off, placeholders are dropped from the assignee
  // picker (except an already-assigned one — see resourceOptions below for risk A).
  const placeholdersEnabled = useStore((s) => s.placeholdersEnabled)
  const calendarTimeZone = useStore((s) => s.data.accounts.find((a) => a.id === s.activeAccountId)?.timezone ?? 'Etc/GMT')
  const isDays = mode === 'days'
  const isBlocks = mode === 'blocks'

  const editId = 'allocationId' in props ? props.allocationId : undefined
  const create = 'create' in props ? props.create : undefined
  const editing = editId ? data.allocations.find((a) => a.id === editId) : undefined

  const initialActivity = editing ? data.activities.find((t) => t.id === editing.activityId) : undefined
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
  // These two hold a NaN while the user has the field empty or part-typed: NumberField.onChange
  // emits NaN for empty/garbage input and only clamps to a real number on blur. We deliberately
  // do NOT guard the NaN here — it's contained by THREE downstream guards so a transient NaN can
  // never reach the store: (1) endDateForSpan clamps the span to [1, MAX_SPAN_DAYS] (a NaN
  // collapses to a valid 1-day span, never an Invalid Date into format()); (2) the submit reject
  // `!(daysOfWork > 0)` fails for NaN (NaN > 0 is false), blocking save with a field error; and
  // (3) hoursPerDayFor is therefore never reached with a NaN daysOfWork on the save path.
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
  // Effective end date + hours, derived TOGETHER in one expression (so they can't desync) from the
  // assignee kind + the account's scheduling mode:
  //   external → a plain typed start/end span, no load (hoursPerDay 0);
  //   blocks   → a (start, days-over) span, no load (0);
  //   days     → a (start, days-over) span, hours rescaled to fit the work volume;
  //   hourly   → the typed end + hours as-is.
  const spanEnd = startDate ? endDateForSpan(startDate, daysOver, daysOpts) : endDate
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

  // Placeholders are gated behind a device-global pref (default OFF). When off, drop them from the
  // assignee picker — EXCEPT the allocation's currently-selected resource (risk A): keep a hidden
  // placeholder in the options when it's the one already assigned, so editing shows the correct
  // value in the <select> instead of silently reassigning the work to someone else on save.
  const resourceOptions: Option[] = data.resources
    .filter((r) => placeholdersEnabled || r.kind !== 'placeholder' || r.id === resourceId)
    .map((r) => ({
      value: r.id,
      label: `${resourceDisplayName(r)}${
        r.kind === 'placeholder' ? ' (slot)' : r.kind === 'external' ? ' (external)' : ''
      }`,
    }))
  // "No project" lets you pick project-less activities (internal + repeatable). A placeholder is
  // offered only its bound project plus this option (it can take project-less activities too).
  const projectOptions: Option[] = [
    { value: '', label: 'No project (internal / repeatable)' },
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
      requiredMessage: 'Enter a name for the new activity.',
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
      fail('resource', 'Choose a resource.')
      return
    }
    if (!activityId) {
      fail('activity', 'Choose (or add) an activity.')
      return
    }
    if (isExternal) {
      // External is a plain span: start + end, no hours (hoursPerDay persists as 0).
      if (!startDate || !endDate) {
        fail('dates', 'Start and end dates are required.')
        return
      }
      if (endDate < startDate) {
        fail('dates', 'End date cannot be before the start date.')
        return
      }
    } else if (isBlocks) {
      // A block is just a span: start + days over (>= 1, so always valid). The end
      // date is derived and load is ignored, so there's nothing else to validate.
      if (!startDate) {
        fail('dates', 'Start date is required.')
        return
      }
    } else if (isDays) {
      // End date is derived, so it can never be reversed; only the start is typed.
      if (!startDate) {
        fail('dates', 'Start date is required.')
        return
      }
      if (!(daysOfWork > 0)) {
        fail('daysOfWork', 'Days of work must be greater than 0.')
        return
      }
    } else {
      if (!startDate || !endDate) {
        fail('dates', 'Start and end dates are required.')
        return
      }
      if (endDate < startDate) {
        fail('dates', 'End date cannot be before the start date.')
        return
      }
      if (!(hoursPerDay > 0)) {
        fail('hours', 'Hours per day must be greater than 0.')
        return
      }
    }
    const cleanNote = validateText(note, fail, { field: 'note', required: false, multiline: true })
    if (cleanNote === null) return
    const activity = data.activities.find((t) => t.id === activityId)
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
      fail(null, e instanceof Error ? e.message : 'Could not save this allocation.')
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
      fail(null, e instanceof Error ? e.message : 'Could not save this allocation.')
    }
  }

  // In create mode the assignee is already chosen (the user clicked the + next to
  // their row), so we drop the Assignee select and name them in the title instead.
  const createName = create ? (initialResource ? resourceDisplayName(initialResource) : 'resource') : undefined

  // Non-blocking capacity advisory (DECISIONS.md: "advisory at allocation time"). The drag-move
  // path shows this as a post-commit toast; surface it HERE too — on the create/edit surface that
  // every keyboard user and every "+"-create reaches. Saving stays allowed (advisory, never a block).
  const advisory = (() => {
    // External parties have no capacity — never show an over-capacity / time-off advisory.
    if (isExternal) return null
    if (!selectedResource || !startDate || !effEndDate) return null
    const others = data.allocations.filter((a) => a.resourceId === resourceId && a.id !== editId)
    const resourceTimeOff = data.timeOff.filter((t) => t.resourceId === resourceId)
    const { overDays, timeOffDays } = capacityAdvisory(selectedResource, others, resourceTimeOff, startDate, effEndDate, effHoursPerDay)
    const bits: string[] = []
    if (overDays) bits.push(`over capacity on ${overDays} ${overDays === 1 ? 'day' : 'days'}`)
    if (timeOffDays) bits.push(`on time off for ${timeOffDays} ${timeOffDays === 1 ? 'day' : 'days'}`)
    return bits.length ? bits.join(' and ') : null
  })()

  return (
    <Modal
      title={
        editing ? (
          'Edit allocation'
        ) : createName ? (
          <>New allocation for <strong>{createName}</strong></>
        ) : (
          'New allocation'
        )
      }
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          {editing && (
            <>
              <Button variant="danger" onClick={() => { deleteAllocation(editing.id); onClose() }}>
                Delete
              </Button>
              <Button variant="ghost" onClick={onDuplicate}>
                Duplicate
              </Button>
            </>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </>
      }
    >
      <RequiredLegend />
      {!create && (
        <SelectField label="Assignee" value={resourceId} onChange={onAssigneeChange} options={resourceOptions} placeholder="— Select resource —" required invalid={errorField === 'resource'} describedById={errorId} />
      )}
      {isPlaceholder && <p className="text-xs text-muted">Placeholder — locked to its bound project.</p>}

      <SelectField
        label="Project"
        value={projectId}
        onChange={onProjectChange}
        options={projectOptions}
      />
      <SelectField label="Activity" value={activityId} onChange={setActivityId} options={activityOptions} placeholder="— Select activity —" required invalid={errorField === 'activity'} describedById={errorId} />
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={newActivityName}
          maxLength={MAX_NAME_LENGTH}
          placeholder={projectId ? '…or add a new activity' : '…or add a new repeatable activity'}
          aria-label="New activity name"
          aria-invalid={errorField === 'newactivity' || undefined}
          onChange={(e) => setNewActivityName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddActivity() } }}
        />
        <Button variant="ghost" onClick={onAddActivity}>
          Add activity
        </Button>
      </div>

      {isExternal ? (
        <div className="flex gap-2">
          <div className="flex-1">
            <DateField label="Start Date" value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
          </div>
          <div className="flex-1">
            <DateField label="End" value={endDate} onChange={setEndDate} required invalid={errorField === 'dates'} describedById={errorId} />
          </div>
        </div>
      ) : isBlocks ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField label="Start Date" value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <NumberField label="Days over" value={daysOver} onChange={setDaysOver} min={1} max={MAX_SPAN_DAYS} step={1} />
            </div>
          </div>
          {startDate && endDateHint && (
            <p className="text-xs text-muted">Ends {endDateHint}</p>
          )}
        </>
      ) : isDays ? (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField label="Start Date" value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <NumberField label="Days of work" value={daysOfWork} onChange={setDaysOfWork} min={0} step={0.5} required invalid={errorField === 'daysOfWork'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <NumberField label="Days over" value={daysOver} onChange={setDaysOver} min={1} max={MAX_SPAN_DAYS} step={1} />
            </div>
          </div>
          {startDate && endDateHint && (
            <p className="text-xs text-muted">Ends {endDateHint} · {round2(effHoursPerDay)}h/day</p>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <div className="flex-1">
              <DateField label="Start Date" value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
            <div className="flex-1">
              <DateField label="End" value={endDate} onChange={setEndDate} required invalid={errorField === 'dates'} describedById={errorId} />
            </div>
          </div>

          <NumberField label="Hours / day" value={hoursPerDay} onChange={setHoursPerDay} min={0} max={24} required invalid={errorField === 'hours'} describedById={errorId} />
        </>
      )}
      <SelectField label="Status" value={status} onChange={(v) => setStatus(v as AllocationStatus)} options={ALLOCATION_STATUS_OPTIONS} />
      <TextAreaField label="Note" value={note} onChange={setNote} invalid={errorField === 'note'} describedById={errorId} />

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
          <span>Include weekends as working days</span>
        </label>
      )}

      {advisory && <Callout>This allocation is {advisory}. Saving is still allowed.</Callout>}
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
