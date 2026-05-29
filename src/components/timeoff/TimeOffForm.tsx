import { useState } from 'react'
import { useStore } from '../../store/useStore'
import { todayISO } from '../../lib/dateMath'
import { Button, DateField, FieldError, Modal, SelectField, TextAreaField, type Option } from '../common/ui'
import { TIME_OFF_TYPE_OPTIONS } from '../../lib/metadata'
import type { ISODate, TimeOff, TimeOffType } from '../../types/entities'

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
  const resources = useStore((s) => s.data.resources)

  const [resourceId, setResourceId] = useState(timeOff?.resourceId ?? defaults?.resourceId ?? '')
  const [startDate, setStartDate] = useState(timeOff?.startDate ?? defaults?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState(timeOff?.endDate ?? defaults?.endDate ?? todayISO())
  const [type, setType] = useState<TimeOffType>(timeOff?.type ?? 'holiday')
  const [note, setNote] = useState(timeOff?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const resourceOptions: Option[] = resources.map((r) => ({ value: r.id, label: r.name ?? r.role }))

  const submit = () => {
    if (!resourceId) {
      setError('Choose a resource.')
      return
    }
    if (!startDate || !endDate) {
      setError('Start and end dates are required.')
      return
    }
    if (endDate < startDate) {
      setError('End date cannot be before the start date.')
      return
    }
    const patch = { resourceId, startDate, endDate, type, note: note.trim() ? note.trim() : undefined }
    if (timeOff) update(timeOff.id, patch)
    else add(patch)
    onClose()
  }

  return (
    <Modal
      title={timeOff ? 'Edit time off' : 'Add time off'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </>
      }
    >
      <SelectField label="Resource" value={resourceId} onChange={setResourceId} options={resourceOptions} placeholder="— Select resource —" />
      <DateField label="Start" value={startDate} onChange={setStartDate} />
      <DateField label="End" value={endDate} onChange={setEndDate} />
      <SelectField label="Type" value={type} onChange={(v) => setType(v as TimeOffType)} options={TIME_OFF_TYPE_OPTIONS} />
      <TextAreaField label="Note" value={note} onChange={setNote} />
      <FieldError>{error}</FieldError>
    </Modal>
  )
}
