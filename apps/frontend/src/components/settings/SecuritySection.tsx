import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { MIN_PASSWORD_LENGTH } from "@capacitylens/shared/domain/password";
import { useAuth } from "@/auth/authContext";
import { m } from "@/i18n";
import { FormActions, Modal, RequiredLegend, TextField } from "@/components/common/ui";
import { FieldError } from "@/components/ui/field";
import { useSecurityController } from "./useSecurityController";

type Controller = ReturnType<typeof useSecurityController>;

function PasswordForm({ controller }: { controller: Controller }) {
  const { fieldError, password } = controller;
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
        invalid={fieldError.errorField === "current"}
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
        invalid={fieldError.errorField === "new"}
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
        invalid={fieldError.errorField === "confirm"}
        describedById={fieldError.errorId}
      />
      <FieldError id={fieldError.errorId}>{fieldError.error}</FieldError>
      {controller.message && (
        <p role="status" className="text-sm text-ok">
          {controller.message}
        </p>
      )}
      <RequiredLegend />
    </>
  );
}

function PasswordDialog({
  open,
  onOpenChange,
  controller,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: Controller;
}) {
  const close = () => onOpenChange(false);
  const password = controller.password;
  return (
    open && (
      <Modal
        title={m.settings_security_change_password()}
        onClose={close}
        onSubmit={() => void password.submit()}
        guardDirty={false}
        footer={
          <FormActions
            onCancel={close}
            submitLabel={m.settings_security_change_password()}
            disabled={
              controller.busy || !password.currentPassword || !password.newPassword || !password.confirmPassword
            }
          />
        }
      >
        <PasswordForm controller={controller} />
      </Modal>
    )
  );
}

/** Presents the signed-in identity's password change dialog. */
export function SecuritySection({
  passwordOpen = false,
  onPasswordOpenChange = () => {},
}: {
  passwordOpen?: boolean;
  onPasswordOpenChange?: (open: boolean) => void;
}) {
  const auth = useAuth();
  const controller = useSecurityController();
  const showPassword = allowsPasswordSignIn(auth.authMode);
  const changePasswordOpen = (open: boolean) => {
    if (!open) controller.password.reset();
    onPasswordOpenChange(open);
  };
  return showPassword ? (
    <PasswordDialog open={passwordOpen} onOpenChange={changePasswordOpen} controller={controller} />
  ) : null;
}
