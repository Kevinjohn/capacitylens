import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { placeholdersEnabledFor } from '../../store/selectors'
import { useScopedData } from '../../store/useScopedData'
import { todayISO } from '@floaty/shared/lib/dateMath'
import { validateText } from '../../lib/validation'
import { Button, DateField, FieldError, Modal, RequiredLegend, SelectField, TextAreaField, type Option } from '../common/ui'
import { TIME_OFF_TYPE_OPTIONS, resourceDisplayName } from '../../lib/metadata'
import { isExternalResource } from '@floaty/shared/types/entities'
import type { ISODate, TimeOff, TimeOffType } from '@floaty/shared/types/entities'

export function TimeOffForm({
  timeOff,
  defaults,
  onClose,
}: {
  timeOff?: TimeOff
  /** Prefill for a new entry (e.g. drawn on the timeline). */
  defaults?: { resourceId?: string; startDate?: ISODate; endDate?: ISODate }
  onClose: () => void
}) {
  const add = useStore((s) => s.addTimeOff)
  const update = useStore((s) => s.updateTimeOff)
  const placeholdersEnabled = useStore((s) => placeholdersEnabledFor(s.data, s.activeAccountId))
  const calendarTimeZone = useStore((s) => s.data.accounts.find((a) => a.id === s.activeAccountId)?.timezone ?? 'Etc/GMT')
  const resources = useScopedData().resources

  const [resourceId, setResourceId] = useState(timeOff?.resourceId ?? defaults?.resourceId ?? '')
  const [startDate, setStartDate] = useState(timeOff?.startDate ?? defaults?.startDate ?? todayISO(calendarTimeZone))
  const [endDate, setEndDate] = useState(timeOff?.endDate ?? defaults?.endDate ?? todayISO(calendarTimeZone))
  const [type, setType] = useState<TimeOffType>(timeOff?.type ?? 'holiday')
  const [note, setNote] = useState(timeOff?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
  const fail = (field: string | null, message: string) => {
    setError(message)
    setErrorField(field)
  }

  // External / 3rd parties have no capacity, so time off is meaningless for them — exclude them.
  // Placeholders are gated behind a per-account pref (default OFF); when off, drop them too —
  // EXCEPT the entry's currently-selected resource (risk A): keep a hidden placeholder in the
  // options when it's the one already assigned, so editing shows the correct value in the <select>
  // instead of silently reassigning the time off to someone else on save.
  const resourceOptions: Option[] = resources
    .filter((r) => !isExternalResource(r))
    .filter((r) => placeholdersEnabled || r.kind !== 'placeholder' || r.id === resourceId)
    .map((r) => ({ value: r.id, label: resourceDisplayName(r) }))

  const submit = () => {
    // Reject an empty pick AND a resource that isn't a valid time-off target: externals have no
    // capacity (the picker omits them, but a draw on an external lane could seed one), so guard the
    // write boundary too rather than persist an orphan time-off the schedule never renders.
    const chosen = resources.find((r) => r.id === resourceId)
    if (!chosen || isExternalResource(chosen)) {
      fail('resource', 'Choose a resource.')
      return
    }
    if (!startDate || !endDate) {
      fail('dates', 'Start and end dates are required.')
      return
    }
    if (endDate < startDate) {
      fail('dates', 'End date cannot be before the start date.')
      return
    }
    const cleanNote = validateText(note, fail, { field: 'note', required: false, multiline: true })
    if (cleanNote === null) return
    const patch = { resourceId, startDate, endDate, type, note: cleanNote ? cleanNote : undefined }
    try {
      if (timeOff) update(timeOff.id, patch)
      else add(patch)
      onClose()
    } catch (e) {
      fail(null, e instanceof Error ? e.message : 'Could not save this time off.')
    }
  }

  return (
    <Modal
      title={timeOff ? 'Edit time off' : 'Add time off'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </>
      }
    >
      <RequiredLegend />
      <SelectField label="Resource" value={resourceId} onChange={setResourceId} options={resourceOptions} placeholder="— Select resource —" required invalid={errorField === 'resource'} describedById={errorId} />
      <DateField label="Start" value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
      <DateField label="End" value={endDate} onChange={setEndDate} required invalid={errorField === 'dates'} describedById={errorId} />
      <SelectField label="Type" value={type} onChange={(v) => setType(v as TimeOffType)} options={TIME_OFF_TYPE_OPTIONS} />
      <TextAreaField label="Note" value={note} onChange={setNote} invalid={errorField === 'note'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
