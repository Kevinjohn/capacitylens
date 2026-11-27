import { useFormLifetimeClose } from '@/hooks/useFormLifetimeClose'
import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { useEditSubmit } from '@/hooks/useEditSubmit'
import { useFieldError } from '@/hooks/useFieldError'
import { validatePresetColor, parseName } from '@/lib/validation'
import { m } from '@/i18n'
import {
  ColorField,
  FormButtons,
  FormDialog,
  RequiredLegend,
  TextField,
} from '@/components/common/ui'
import { PrivateNameFields } from '@/components/common/PrivateNameFields'
import { usePrivateNameFields } from '@/components/common/usePrivateNameFields'
import { FieldError } from '@/components/ui/field'
import { DEFAULT_COLORS } from '@/lib/palette'
import type { Client } from '@capacitylens/shared/types/entities'

function ClientFormFields({
  name,
  onNameChange,
  privateNameFields,
  color,
  onColorChange,
  errorField,
  errorId,
  error,
  pending,
}: {
  name: string
  onNameChange: (value: string) => void
  privateNameFields: ReturnType<typeof usePrivateNameFields>
  color: string
  onColorChange: (value: string) => void
  errorField: string | null
  errorId: string
  error: string | null
  pending: boolean
}) {
  return (
    <>
      <TextField
        label={m.form_client_name_label()}
        value={name}
        onChange={onNameChange}
        autoFocus={!privateNameFields.protectedName}
        required
        disabled={pending || privateNameFields.protectedName}
        invalid={errorField === 'name'}
        describedById={errorId}
        layout="label-control"
      />
      <PrivateNameFields
        fields={privateNameFields}
        errorField={errorField}
        errorId={errorId}
        layout="label-control"
        disabled={pending}
      />
      <ColorField
        label={m.form_client_colour_label()}
        value={color}
        onChange={onColorChange}
        invalid={errorField === 'color'}
        describedById={errorId}
        layout="label-control"
        disabled={pending}
      />
      <FieldError id={errorId}>{error}</FieldError>
      <RequiredLegend />
    </>
  )
}

/** Add (no `client`) or edit a client: name + preset colour. `onClose` fires on save or cancel. */
export function ClientForm({ client, onClose: close }: { client?: Client; onClose: () => void }) {
  const onClose = useFormLifetimeClose(close)
  const addClient = useStore((state) => state.addClient)
  const updateClient = useStore((state) => state.updateClient)
  const [name, setName] = useState(client?.name ?? '')
  const [color, setColor] = useState(client?.color ?? DEFAULT_COLORS.client)
  const { error, errorField, errorId, fail } = useFieldError()
  const privateNameFields = usePrivateNameFields(client, fail)
  const clients = useStore((state) => state.data.clients)
  const { pending, submit } = useEditSubmit({
    editing: client,
    rows: clients,
    staleMessage: m.form_client_err_changed,
    fail,
    onSaved: onClose,
  })

  const prepareSave = () => {
    const trimmed = parseName(name, fail)
    if (!trimmed) return null
    const privacy = privateNameFields.parsePrivacyPatch()
    if (!privacy) return null
    if (!validatePresetColor(color, fail)) return null
    if (client) {
      return () => updateClient(client.id, { name: trimmed, color, ...privacy }, client.updatedAt)
    }
    return () =>
      addClient({
        name: trimmed,
        color,
        ...(privacy.isPrivate && privacy.codeName
          ? { isPrivate: privacy.isPrivate, codeName: privacy.codeName }
          : {}),
      })
  }

  return (
    <FormDialog
      title={client ? m.form_client_edit_title() : m.form_client_add_title()}
      onClose={onClose}
      onSubmit={() => {
        void submit(prepareSave)
      }}
      footer={<FormButtons onCancel={onClose} disabled={pending} />}
    >
      <ClientFormFields
        name={name}
        onNameChange={setName}
        privateNameFields={privateNameFields}
        color={color}
        onColorChange={setColor}
        errorField={errorField}
        errorId={errorId}
        error={error}
        pending={pending}
      />
    </FormDialog>
  )
}
