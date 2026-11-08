import { useRef, useState } from 'react';
import {
  MAX_PASSWORD_INPUT_CODE_UNITS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordLengthFailure,
} from '@capacitylens/shared/domain/password';
import { authClient } from '@/auth/authClient';
import { useFieldError } from '@/hooks/useFieldError';
import { m } from '@/i18n';

type Fail = ReturnType<typeof useFieldError>['fail'];

interface PasswordChangeInput {
  fail: Fail;
  clear: () => void;
  setMessage: (message: string | null) => void;
  setBusy: (busy: boolean) => void;
}

function usePasswordChange({ fail, clear, setMessage, setBusy }: PasswordChangeInput) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const generation = useRef(0);

  const reset = () => {
    generation.current += 1;
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    clear();
    setMessage(null);
  };

  const submit = async () => {
    clear();
    setMessage(null);
    if (currentPassword.length > MAX_PASSWORD_INPUT_CODE_UNITS) {
      fail('current', m.login_password_input_too_long());
      return;
    }
    if (passwordLengthFailure(newPassword)) {
      fail(
        'new',
        m.settings_security_err_password_length({
          min: MIN_PASSWORD_LENGTH,
          max: MAX_PASSWORD_LENGTH,
        }),
      );
      return;
    }
    if (passwordLengthFailure(confirmPassword) === 'too-long') {
      fail(
        'confirm',
        m.settings_security_err_password_length({
          min: MIN_PASSWORD_LENGTH,
          max: MAX_PASSWORD_LENGTH,
        }),
      );
      return;
    }
    if (newPassword !== confirmPassword) {
      return fail('confirm', m.settings_security_err_password_mismatch());
    }
    const requestGeneration = ++generation.current;
    setBusy(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword });
      // A committed update whose follow-up failed still changed the password, so the old inputs are obsolete.
      const committedWithWarning = result.error?.code === 'CREDENTIAL_UPDATE_COMMITTED';
      if (result.error && !committedWithWarning) {
        if (requestGeneration === generation.current) fail('current', result.error.message);
        return;
      }
      // Completion is authoritative even after dismissal; only the current dialog may receive feedback.
      if (requestGeneration === generation.current) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setMessage(
          committedWithWarning
            ? m.settings_security_password_changed_warning()
            : m.settings_security_password_changed(),
        );
      }
      // The change ended every sign-in, this one included; reload to sign in with the new password.
      window.location.assign('/');
    } catch (cause) {
      // Log authentication-service failure, but publish it only while the password-change request owns the form.
      console.error('SecuritySection: password change failed', cause);
      if (requestGeneration === generation.current) {
        fail('current', m.settings_security_err_password_outcome_unknown());
      }
    } finally {
      setBusy(false);
    }
  };

  return {
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    reset,
    submit,
  };
}

function useAccountDeletion({ fail, clear, setMessage, setBusy }: PasswordChangeInput) {
  const [currentPassword, setCurrentPassword] = useState('');
  const generation = useRef(0);

  const reset = () => {
    generation.current += 1;
    setCurrentPassword('');
    clear();
    setMessage(null);
  };

  const submit = async () => {
    clear();
    setMessage(null);
    if (currentPassword.length > MAX_PASSWORD_INPUT_CODE_UNITS) {
      fail('current', m.login_password_input_too_long());
      return;
    }
    const requestGeneration = ++generation.current;
    setBusy(true);
    try {
      const result = await authClient.deleteAccount({ currentPassword });
      // A committed deletion whose follow-up failed still removed the account and ended the sign-in.
      if (result.error && result.error.code !== 'ACCOUNT_DELETION_COMMITTED') {
        if (requestGeneration !== generation.current) return;
        if (result.error.code === 'LAST_OWNER') {
          fail(null, m.settings_security_err_delete_owner());
        } else {
          fail('current', result.error.message);
        }
        return;
      }
      // The identity is gone and the server ended this sign-in; reload to reach the sign-in wall.
      window.location.assign('/');
    } catch (cause) {
      console.error('SecuritySection: account deletion failed', cause);
      if (requestGeneration === generation.current) {
        fail('current', m.settings_security_err_delete_outcome_unknown());
      }
    } finally {
      setBusy(false);
    }
  };

  return { currentPassword, setCurrentPassword, reset, submit };
}

/** Coordinates password, deletion and session controls with their busy and error states. */
export function useSecurityController() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fieldError = useFieldError();
  const password = usePasswordChange({
    fail: fieldError.fail,
    clear: fieldError.clear,
    setMessage,
    setBusy,
  });

  const deletion = useAccountDeletion({
    fail: fieldError.fail,
    clear: fieldError.clear,
    setMessage,
    setBusy,
  });

  return { busy, setBusy, message, fieldError, password, deletion };
}
