import { isRecord } from '@capacitylens/shared/lib/isRecord';
import { useStore } from '@/store/useStore';
import { readApiError } from '@/lib/readApiError';
import { m } from '@/i18n';
import { isAuthMode } from './authStatus';
import type { AccessGate, AdmissionSummary, AuthStatusResult } from './authStatus';
import { parseAuthUser } from './validateAuthUser';

interface AuthResponseFields {
  admission: unknown;
  authMode: unknown;
  emailVerified: unknown;
  membershipRequired: unknown;
  canCreateAccount: unknown;
  companySetupRequired: unknown;
  needsSetup: unknown;
  passwordResetEmail: unknown;
  user: unknown;
}

function readField(value: object, key: keyof AuthResponseFields): unknown {
  return Reflect.get(value, key);
}

function parseAuthResponseFields(value: unknown): AuthResponseFields | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return {
    admission: readField(value, 'admission'),
    authMode: readField(value, 'authMode'),
    emailVerified: readField(value, 'emailVerified'),
    membershipRequired: readField(value, 'membershipRequired'),
    canCreateAccount: readField(value, 'canCreateAccount'),
    companySetupRequired: readField(value, 'companySetupRequired'),
    needsSetup: readField(value, 'needsSetup'),
    passwordResetEmail: readField(value, 'passwordResetEmail'),
    user: readField(value, 'user'),
  };
}

function parseLoginResult(body: unknown): AuthStatusResult {
  const fields = parseAuthResponseFields(body);
  const rawAuthMode = fields?.authMode;
  const authMode = isAuthMode(rawAuthMode) && rawAuthMode !== 'off' ? rawAuthMode : 'password-only';
  const degraded =
    fields === null ||
    (rawAuthMode !== undefined && (!isAuthMode(rawAuthMode) || rawAuthMode === 'off'));
  return {
    kind: 'login',
    authMode,
    degraded,
    hadUnsavedChanges: useStore.getState().planning.pending !== null,
    needsSetup: fields?.needsSetup === true,
    passwordResetEmail: fields?.passwordResetEmail === true,
  };
}

const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'revoked']);

/** Reads the Account Kit decision the limited screen explains; null when the field is malformed. */
function parseAdmission(value: unknown): { admitted: boolean; summary: AdmissionSummary } | null {
  if (!isRecord(value) || typeof value.admitted !== 'boolean' || !isRecord(value.requirements)) {
    return null;
  }
  const { requirements } = value;
  const approval = isRecord(requirements.approval) ? requirements.approval : {};
  const status =
    typeof approval.status === 'string' && APPROVAL_STATUSES.has(approval.status)
      ? approval.status
      : 'pending';
  const invitation = isRecord(requirements.invitation) ? requirements.invitation : null;
  const domain = isRecord(requirements.domain) ? requirements.domain : null;
  return {
    admitted: value.admitted,
    summary: {
      approvalStatus: status as AdmissionSummary['approvalStatus'],
      requested: approval.requested === true,
      invitationMissing: invitation?.met === false,
      domainRefused: domain?.met === false && domain.reason === 'not_allowed',
    },
  };
}

/** The first limited screen that applies, in the order the server enforces them. */
function resolveAccessGate(fields: AuthResponseFields, admitted: boolean): AccessGate | undefined {
  if (fields.emailVerified === false) return 'verify-email';
  if (!admitted) return 'admission';
  if (fields.membershipRequired === true) return 'membership';
  return undefined;
}

/** Reject identity responses whose mode cannot be trusted. */
export function invalidResponse(): AuthStatusResult {
  console.warn(
    'AuthProvider: /api/auth/me returned an unexpected body; nothing trustworthy learned',
  );
  return { kind: 'error', message: m.auth_service_invalid_response() };
}

function parsePassResult(body: unknown): AuthStatusResult {
  const fields = parseAuthResponseFields(body);
  if (!fields || !isAuthMode(fields.authMode) || fields.authMode === 'off') {
    return invalidResponse();
  }
  const authMode = fields.authMode;
  const user = parseAuthUser({ value: fields.user, requireEmail: true });
  if (!user) {
    console.warn('AuthProvider: /api/auth/me returned auth-on without a valid user');
    return { kind: 'error', message: m.auth_service_invalid_response() };
  }
  const admission = parseAdmission(fields.admission);
  // A missing gate field must not open the shell; the server still refuses data either way.
  if (
    !admission ||
    typeof fields.emailVerified !== 'boolean' ||
    typeof fields.membershipRequired !== 'boolean'
  ) {
    return invalidResponse();
  }
  const accessGate = resolveAccessGate(fields, admission.admitted);
  const next: Extract<AuthStatusResult, { kind: 'pass' }> = {
    kind: 'pass',
    identitySource: 'live',
    authMode,
    user,
    canCreateAccount: false,
    companySetupRequired: fields.companySetupRequired === true,
    ...(accessGate ? { accessGate } : {}),
    admission: admission.summary,
  };
  return next;
}

/** Parse the native identity response. */
export async function readAuthResponse(res: Response): Promise<AuthStatusResult> {
  if (res.status === 401) {
    // A 401 always offers sign-in. An unreadable body degrades to the password form.
    const body: unknown = await res.json().catch(() => null);
    return parseLoginResult(body);
  }
  if (res.ok) return parsePassResult(await res.json());
  if (res.status === 503) {
    return {
      kind: 'error',
      message: (await readApiError(res)) ?? m.auth_check_failed({ status: res.status }),
    };
  }
  return { kind: 'error', message: m.auth_check_failed({ status: res.status }) };
}
