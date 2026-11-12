import type { AuthUser } from './authContext';

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
      user: AuthUser;
      companySetupRequired?: boolean;
      accessGate?: AccessGate;
      admission?: AdmissionSummary;
    }
  | {
      kind: 'login';
      passwordResetEmail: boolean;
      needsSetup: boolean;
      /** True when the 401 body itself was untrustworthy (non-JSON or an HTML proxy page). The login
       * wall then shows a non-terminal "configuration couldn't be loaded" notice above the password
       * form. */
      degraded: boolean;
      /** Captured synchronously at the 401 boundary, before replacing the app detaches persistence. */
      hadUnsavedChanges: boolean;
    };
