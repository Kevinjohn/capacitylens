import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { placeholdersEnabledFor } from '../../store/selectors'
import { useActiveScopedData } from '../../store/useScopedData'
import { todayISO } from '@capacitylens/shared/lib/dateMath'
import { validateText } from '../../lib/validation'
import { m } from '@/i18n'
import { Button, DateField, FieldError, Modal, RequiredLegend, SelectField, TextAreaField, type Option } from '../common/ui'
import { timeOffTypeOptions, resourceDisplayName } from '../../lib/metadata'
import { isExternalResource } from '@capacitylens/shared/types/entities'
import type { ISODate, TimeOff, TimeOffType } from '@capacitylens/shared/types/entities'

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
  const resources = useActiveScopedData().resources

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
      fail('resource', m.form_timeoff_err_choose_resource())
      return
    }
    if (!startDate || !endDate) {
      fail('dates', m.form_timeoff_err_dates_required())
      return
    }
    if (endDate < startDate) {
      fail('dates', m.form_timeoff_err_end_before_start())
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
      fail(null, e instanceof Error ? e.message : m.form_timeoff_err_save_failed())
    }
  }

  return (
    <Modal
      title={timeOff ? m.form_timeoff_edit_title() : m.form_timeoff_add_title()}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {m.form_cancel()}
          </Button>
          <Button type="submit">{m.form_save()}</Button>
        </>
      }
    >
      <RequiredLegend />
      <SelectField label={m.form_timeoff_resource_label()} value={resourceId} onChange={setResourceId} options={resourceOptions} placeholder={m.form_timeoff_select_resource_placeholder()} required invalid={errorField === 'resource'} describedById={errorId} />
      <DateField label={m.form_timeoff_start_label()} value={startDate} onChange={setStartDate} required invalid={errorField === 'dates'} describedById={errorId} />
      <DateField label={m.form_timeoff_end_label()} value={endDate} onChange={setEndDate} required invalid={errorField === 'dates'} describedById={errorId} />
      <SelectField label={m.form_timeoff_type_label()} value={type} onChange={(v) => setType(v as TimeOffType)} options={timeOffTypeOptions()} />
      <TextAreaField label={m.form_timeoff_note_label()} value={note} onChange={setNote} invalid={errorField === 'note'} describedById={errorId} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
