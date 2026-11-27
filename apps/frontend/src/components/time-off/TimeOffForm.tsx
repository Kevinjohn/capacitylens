import { useFormLifetimeClose } from '@/hooks/useFormLifetimeClose'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '@/store/useStore'
import { hasPlaceholdersEnabled } from '@/store/selectors'
import { useActiveScopedData } from '@/store/useScopedData'
import { useEditSubmit } from '@/hooks/useEditSubmit'
import { useFieldError, useFieldErrorFocus } from '@/hooks/useFieldError'
import { useCompanyToday } from '@/hooks/useCompanyToday'
import { m } from '@/i18n'
import {
  DateField,
  FormButtons,
  FormDialog,
  RequiredLegend,
  SelectField,
  TextField,
} from '@/components/common/ui'
import type { Option } from '@/components/common/ui'
import { FieldError } from '@/components/ui/field'
import { buildTimeOffTypeOptions, resolveResourceDisplayName } from '@/lib/metadata'
import { resolveErrorMessage } from '@/lib/errorMessage'
import { isResourceKindEnabled } from '@/lib/resourceGrouping'
import { isExternalResource } from '@capacitylens/shared/types/entities'
import type { ISODate, TimeOff, TimeOffType } from '@capacitylens/shared/types/entities'
import { useAccessGrant } from '@/auth/permissionContext'
import { useTimeOffRepeat } from './useTimeOffRepeat'
import { TimeOffRepeatFields } from './TimeOffRepeatFields'
import { prepareTimeOffSave } from './timeOffFormSubmission'

interface TimeOffFormProps {
  timeOff?: TimeOff
  defaults?: { resourceId?: string; startDate?: ISODate; endDate?: ISODate }
  onClose: () => void
}
interface TimeOffFieldsProps {
  resourceId: string
  setResourceId: (value: string) => void
  resourceOptions: Option[]
  startDate: ISODate | ''
  setStartDate: (value: ISODate) => void
  endDate: ISODate | ''
  setEndDate: (value: ISODate) => void
  type: TimeOffType
  setType: (value: TimeOffType) => void
  note: string
  setNote: (value: string) => void
  canEditNote: boolean
  errorField: string | null
  errorId: string
  repeatFields?: ReactNode
  pending: boolean
}

interface TimeOffDraftOptions {
  timeOff: TimeOff | undefined
  defaults: TimeOffFormProps['defaults']
  today: ISODate
  canEditNote: boolean
}

function resolveDraftValue<T>(stored: T | undefined, fallback: T | undefined, defaultValue: T): T {
  return stored ?? fallback ?? defaultValue
}

function useTimeOffDraft({ timeOff, defaults, today, canEditNote }: TimeOffDraftOptions) {
  const [resourceId, setResourceId] = useState(
    resolveDraftValue(timeOff?.resourceId, defaults?.resourceId, '')
  )
  const [startDate, setStartDate] = useState(
    resolveDraftValue(timeOff?.startDate, defaults?.startDate, today)
  )
  const [endDate, setEndDate] = useState(
    resolveDraftValue(timeOff?.endDate, defaults?.endDate, today)
  )
  const [type, setType] = useState<TimeOffType>(timeOff?.type ?? 'holiday')
  const initialNote = canEditNote ? (timeOff?.note ?? '') : ''
  const [note, setNote] = useState(initialNote)
  return {
    resourceId,
    setResourceId,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    type,
    setType,
    note,
    setNote,
  }
}

type UseTimeOffResourceOptionsOptions = {
  resources: ReturnType<typeof useActiveScopedData>['resources']
  placeholdersEnabled: boolean
  resourceId: string
}
function useTimeOffResourceOptions({
  resources,
  placeholdersEnabled,
  resourceId,
}: UseTimeOffResourceOptionsOptions): Option[] {
  const filteredResources = useMemo(
    () =>
      resources
        .filter((resource) => !isExternalResource(resource))
        .filter(
          (resource) =>
            resource.id === resourceId ||
            isResourceKindEnabled(resource, { placeholdersEnabled, externalEnabled: false })
        ),
    [resources, placeholdersEnabled, resourceId]
  )
  return filteredResources.map((resource) => ({
    value: resource.id,
    label: resolveResourceDisplayName(resource),
  }))
}

function buildTimeOffRepeatFields(options: {
  timeOff: TimeOff | undefined
  startDate: ISODate | ''
  repeatState: ReturnType<typeof useTimeOffRepeat>
  errorField: string | null
  errorId: string
  disabled: boolean
}): ReactNode {
  if (options.timeOff) return undefined
  const { repeat, repeatUntil, maximum, preview, changeRepeat, changeRepeatUntil } =
    options.repeatState
  return (
    <TimeOffRepeatFields
      startDate={options.startDate}
      repeat={repeat}
      repeatUntil={repeatUntil}
      repeatUntilMaximum={maximum}
      expansion={preview}
      errorField={options.errorField}
      errorId={options.errorId}
      disabled={options.disabled}
      onRepeatChange={changeRepeat}
      onRepeatUntilChange={changeRepeatUntil}
    />
  )
}

function useCanEditTimeOffNote(): boolean {
  return useAccessGrant().canSeeTimeOffNote
}

/** Creates or edits time off for an authorised resource. */
export function TimeOffForm({ timeOff, defaults, onClose: close }: TimeOffFormProps) {
  const onClose = useFormLifetimeClose(close)
  const add = useStore((state) => state.addTimeOff)
  const addRepeated = useStore((state) => state.addRepeatedTimeOff)
  const update = useStore((state) => state.updateTimeOff)
  const placeholdersEnabled = useStore((state) =>
    hasPlaceholdersEnabled(state.data, state.activeCompanyId)
  )
  const today = useCompanyToday()
  const resources = useActiveScopedData().resources
  const canEditNote = useCanEditTimeOffNote()

  const fields = useTimeOffDraft({ timeOff, defaults, today, canEditNote })
  const acceptedSubmission = useRef(false)
  const repeatState = useTimeOffRepeat(fields)
  const fieldError = useFieldError()
  const { error, errorField, errorId, fail, clear } = fieldError
  useFieldErrorFocus(fieldError)
  const timeOffRows = useStore((state) => state.data.timeOff)
  const { pending, submit } = useEditSubmit({
    editing: timeOff,
    rows: timeOffRows,
    staleMessage: m.form_time_off_err_changed,
    failedMessage: m.form_time_off_err_save_failed,
    cancelledMessage: resolveErrorMessage,
    fail,
    onSaved: onClose,
  })

  const resourceOptions = useTimeOffResourceOptions({
    resources,
    placeholdersEnabled,
    resourceId: fields.resourceId,
  })
  const repeatFields = buildTimeOffRepeatFields({
    timeOff,
    startDate: fields.startDate,
    repeatState,
    errorField,
    errorId,
    disabled: pending,
  })

  const prepareSave = () =>
    prepareTimeOffSave({
      timeOff,
      resources,
      ...fields,
      canEditNote,
      fail,
      add,
      addRepeated,
      update,
      repeat: repeatState.repeat,
      repeatUntil: repeatState.repeatUntil,
      acceptedSubmission,
    })

  return (
    <FormDialog
      title={timeOff ? m.form_time_off_edit_title() : m.form_time_off_add_title()}
      onClose={onClose}
      onSubmit={() => {
        submit(prepareSave).catch((cause: unknown) => fail(null, resolveErrorMessage(cause)))
      }}
      onEdit={clear}
      footer={<FormButtons onCancel={onClose} disabled={pending} />}
    >
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <TimeOffFields
          {...fields}
          resourceOptions={resourceOptions}
          canEditNote={canEditNote}
          errorField={errorField}
          errorId={errorId}
          repeatFields={repeatFields}
          pending={pending}
        />
      </fieldset>
      <FieldError id={errorId} tabIndex={error && errorField === null ? -1 : undefined}>
        {error}
      </FieldError>
      <RequiredLegend />
    </FormDialog>
  )
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
  pending,
}: TimeOffFieldsProps) {
  return (
    <>
      <SelectField
        label={m.form_time_off_resource_label()}
        value={resourceId}
        onChange={setResourceId}
        options={resourceOptions}
        placeholder={m.form_time_off_select_resource_placeholder()}
        required
        invalid={errorField === 'resource'}
        describedById={errorId}
        layout="label-control"
        disabled={pending}
      />
      <TimeOffDateFields
        startDate={startDate}
        setStartDate={setStartDate}
        endDate={endDate}
        setEndDate={setEndDate}
        invalid={errorField === 'dates'}
        errorId={errorId}
        disabled={pending}
      />
      <SelectField
        label={m.form_time_off_type_label()}
        value={type}
        onChange={(value) => setType(value as TimeOffType)}
        options={buildTimeOffTypeOptions()}
        layout="label-control"
        disabled={pending}
      />
      {repeatFields}
      {canEditNote && (
        <TextField
          label={m.form_time_off_note_label()}
          value={note}
          onChange={setNote}
          invalid={errorField === 'note'}
          describedById={errorId}
          layout="label-control"
          disabled={pending}
        />
      )}
    </>
  )
}

function TimeOffDateFields({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  invalid,
  errorId,
  disabled,
}: {
  startDate: ISODate | ''
  setStartDate: (value: ISODate) => void
  endDate: ISODate | ''
  setEndDate: (value: ISODate) => void
  invalid: boolean
  errorId: string
  disabled: boolean
}) {
  return (
    <div data-time-off-date-row className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      <DateField
        label={m.form_time_off_start_label()}
        value={startDate}
        onChange={setStartDate}
        required
        invalid={invalid}
        describedById={errorId}
        disabled={disabled}
      />
      <DateField
        label={m.form_time_off_end_label()}
        value={endDate}
        onChange={setEndDate}
        required
        invalid={invalid}
        describedById={errorId}
        disabled={disabled}
      />
    </div>
  )
}
