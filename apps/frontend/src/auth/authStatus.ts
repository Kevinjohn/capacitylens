import type { AccountMode, AuthUser } from './authContext';

/**
 * The limited screen a signed-in identity sees before company data: an unconfirmed address, a
 * pending or refused admission, or an admitted person who has not yet joined the company.
 */
export type AccessGate = 'verify-email' | 'admission' | 'membership';

/** The parts of the server's admission decision the limited screen explains. */
export interface AdmissionSummary {
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'revoked';
  requested: boolean;
  /** Admission needs invitation evidence this identity does not have; approval alone cannot admit it. */
  invitationMissing: boolean;
  /** The confirmed address is outside the allowed domains. */
  domainRefused: boolean;
}

/** Possible outcomes while resolving the current auth mode and user access. */
export type AuthStatusResult =
  | { kind: 'checking' }
  | { kind: 'error'; message: string }
  | {
      kind: 'pass';
      /** Identifies whether tenant access was confirmed by a live session or opened in the demo. */
      identitySource?: 'live' | 'open';
      authMode: AccountMode;
      user: AuthUser | null;
      canCreateAccount: boolean;
      companySetupRequired?: boolean;
      accessGate?: AccessGate;
      admission?: AdmissionSummary;
    }
  | {
      kind: 'login';
      passwordResetEmail: boolean;
      authMode: Exclude<AccountMode, 'off'>;
      needsSetup: boolean;
      /** True when the 401 body itself was untrustworthy (non-JSON, an HTML proxy page, or a junk
       * `authMode` value). The login wall then shows a non-terminal "configuration couldn't be
       * loaded" notice above the password form. */
      degraded: boolean;
      /** Captured synchronously at the 401 boundary, before replacing the app detaches persistence. */
      hadUnsavedChanges: boolean;
    };

// Demo entry uses permissive creation defaults; an unreadable live-auth response remains behind the retryable authentication error boundary.
/** Builds the auth result for the volatile demo that does not request server access metadata. */
export function buildOpenAuthResult(
  authMode: AccountMode,
  user: AuthUser | null,
): AuthStatusResult {
  return {
    kind: 'pass',
    identitySource: 'open',
    authMode,
    user,
    canCreateAccount: true,
  };
}

/** Checks whether an untrusted value is a supported account auth mode. */
export function isAuthMode(value: unknown): value is AccountMode {
  return value === 'off' || value === 'password-only';
}
