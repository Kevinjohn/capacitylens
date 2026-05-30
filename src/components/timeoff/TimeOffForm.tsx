import { useId, useState } from 'react'
import { useStore } from '../../store/useStore'
import { useScopedData } from '../../store/useScopedData'
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
  const resources = useScopedData().resources

  const [resourceId, setResourceId] = useState(timeOff?.resourceId ?? defaults?.resourceId ?? '')
  const [startDate, setStartDate] = useState(timeOff?.startDate ?? defaults?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState(timeOff?.endDate ?? defaults?.endDate ?? todayISO())
  const [type, setType] = useState<TimeOffType>(timeOff?.type ?? 'holiday')
  const [note, setNote] = useState(timeOff?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [errorField, setErrorField] = useState<string | null>(null)
  const errorId = useId()
  const fail = (field: string | null, message: string) => {
    setError(message)
    setErrorField(field)
  }

  const resourceOptions: Option[] = resources.map((r) => ({ value: r.id, label: r.name ?? r.role }))

  const submit = () => {
    if (!resourceId) {
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
    const patch = { resourceId, startDate, endDate, type, note: note.trim() ? note.trim() : undefined }
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
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save</Button>
        </>
      }
    >
      <SelectField label="Resource" value={resourceId} onChange={setResourceId} options={resourceOptions} placeholder="— Select resource —" invalid={errorField === 'resource'} describedById={errorId} />
      <DateField label="Start" value={startDate} onChange={setStartDate} invalid={errorField === 'dates'} describedById={errorId} />
      <DateField label="End" value={endDate} onChange={setEndDate} invalid={errorField === 'dates'} describedById={errorId} />
      <SelectField label="Type" value={type} onChange={(v) => setType(v as TimeOffType)} options={TIME_OFF_TYPE_OPTIONS} />
      <TextAreaField label="Note" value={note} onChange={setNote} />
      <FieldError id={errorId}>{error}</FieldError>
    </Modal>
  )
}
