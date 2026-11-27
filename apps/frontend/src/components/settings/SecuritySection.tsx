import { MIN_PASSWORD_LENGTH } from '@capacitylens/shared/domain/password'
import { m } from '@/i18n'
import { FormButtons, FormDialog, RequiredLegend, TextField } from '@/components/common/ui'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { useSecurityViewModel } from './useSecurityViewModel'

type ViewModel = ReturnType<typeof useSecurityViewModel>

function PasswordForm({ viewModel }: { viewModel: ViewModel }) {
  const { fieldError, password } = viewModel
  return (
    <>
      <TextField
        label={m.settings_security_current_password()}
        type="password"
        maxLength={null}
        autoComplete="current-password"
        autoFocus
        required
        layout="label-control"
        value={password.currentPassword}
        onChange={password.setCurrentPassword}
        invalid={fieldError.errorField === 'current'}
        describedById={fieldError.errorId}
      />
      <TextField
        label={m.settings_security_new_password()}
        type="password"
        maxLength={null}
        autoComplete="new-password"
        required
        layout="label-control"
        minLength={MIN_PASSWORD_LENGTH}
        value={password.newPassword}
        onChange={password.setNewPassword}
        invalid={fieldError.errorField === 'new'}
        describedById={fieldError.errorId}
      />
      <TextField
        label={m.settings_security_confirm_password()}
        type="password"
        maxLength={null}
        autoComplete="new-password"
        required
        layout="label-control"
        value={password.confirmPassword}
        onChange={password.setConfirmPassword}
        invalid={fieldError.errorField === 'confirm'}
        describedById={fieldError.errorId}
      />
      <FieldError id={fieldError.errorId}>{fieldError.error}</FieldError>
      {viewModel.message && (
        <p role="status" className="text-sm text-ok">
          {viewModel.message}
        </p>
      )}
      <RequiredLegend />
    </>
  )
}

function PasswordDialog({
  open,
  onOpenChange,
  viewModel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  viewModel: ViewModel
}) {
  const close = () => onOpenChange(false)
  const password = viewModel.password
  return (
    open && (
      <FormDialog
        title={m.settings_security_change_password()}
        onClose={close}
        onSubmit={() => void password.submit()}
        warnOnDirty={false}
        footer={
          <FormButtons
            onCancel={close}
            submitLabel={m.settings_security_change_password()}
            disabled={
              viewModel.busy ||
              !password.currentPassword ||
              !password.newPassword ||
              !password.confirmPassword
            }
          />
        }
      >
        <PasswordForm viewModel={viewModel} />
      </FormDialog>
    )
  )
}

function DeleteAccountDialog({
  open,
  onOpenChange,
  viewModel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  viewModel: ViewModel
}) {
  const close = () => onOpenChange(false)
  const { deletion, fieldError } = viewModel
  return (
    open && (
      <FormDialog
        title={m.settings_security_delete_account()}
        description={m.settings_security_delete_account_description()}
        onClose={close}
        onSubmit={() => void deletion.submit()}
        warnOnDirty={false}
        footer={
          <>
            <Button size="sm" type="button" variant="outline" onClick={close}>
              {m.form_cancel()}
            </Button>
            <Button
              size="sm"
              type="submit"
              variant="destructive"
              disabled={viewModel.busy || !deletion.currentPassword}
            >
              {m.settings_security_delete_account()}
            </Button>
          </>
        }
      >
        <TextField
          label={m.settings_security_current_password()}
          type="password"
          maxLength={null}
          autoComplete="current-password"
          autoFocus
          required
          layout="label-control"
          value={deletion.currentPassword}
          onChange={deletion.setCurrentPassword}
          invalid={fieldError.errorField === 'current'}
          describedById={fieldError.errorId}
        />
        <FieldError id={fieldError.errorId}>{fieldError.error}</FieldError>
        <RequiredLegend />
      </FormDialog>
    )
  )
}

/** Presents the signed-in identity's password change and account deletion dialogs. */
export function SecuritySection({
  passwordOpen = false,
  onPasswordOpenChange = () => {},
  deleteOpen = false,
  onDeleteOpenChange = () => {},
}: {
  passwordOpen?: boolean
  onPasswordOpenChange?: (open: boolean) => void
  deleteOpen?: boolean
  onDeleteOpenChange?: (open: boolean) => void
}) {
  const viewModel = useSecurityViewModel()
  const changePasswordOpen = (open: boolean) => {
    if (!open) viewModel.password.reset()
    onPasswordOpenChange(open)
  }
  const changeDeleteOpen = (open: boolean) => {
    if (!open) viewModel.deletion.reset()
    onDeleteOpenChange(open)
  }
  return (
    <>
      <PasswordDialog open={passwordOpen} onOpenChange={changePasswordOpen} viewModel={viewModel} />
      <DeleteAccountDialog
        open={deleteOpen}
        onOpenChange={changeDeleteOpen}
        viewModel={viewModel}
      />
    </>
  )
}
