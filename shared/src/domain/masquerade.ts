import type { IsoInstant, PrincipalId, Role, WorkspaceId } from "../account/types";

/** Reasons a masquerade can end. Only the first two may be supplied by the browser. */
export const MASQUERADE_END_REASONS = [
  "explicit",
  "account_switch",
  "sign_out",
  "session_expired",
  "session_revoked",
  "caller_invalidated",
  "target_invalidated",
] as const;

/** Audit-classified reason for ending one session's masquerade. */
export type MasqueradeEndReason = (typeof MASQUERADE_END_REASONS)[number];

/** End reasons accepted from the browser-facing DELETE route. */
export type ClientMasqueradeEndReason = Extract<MasqueradeEndReason, "explicit" | "account_switch">;

/** Server-computed wire representation of an active identity read projection. */
export interface MasqueradeState {
  accountId: WorkspaceId;
  targetUserId: PrincipalId;
  targetName: string;
  effectiveRole: Role;
  startedAt: IsoInstant;
  token: string;
}

/** Validated request body for starting a masquerade. */
export interface StartMasqueradePayload {
  targetUserId: PrincipalId;
}

/** Validated request body for ending a masquerade. */
export interface EndMasqueradePayload {
  token: string;
  reason: ClientMasqueradeEndReason;
}

/** Response from the session-scoped masquerade status endpoint. */
export type MasqueradeStatus = { active: false } | ({ active: true } & MasqueradeState);

/** Stable machine-readable failures shared by server guards and browser recovery. */
export const MASQUERADE_ERROR_CODES = {
  active: "MASQUERADE_ACTIVE",
  readOnly: "MASQUERADE_READ_ONLY",
  ended: "MASQUERADE_ENDED",
} as const;

/** Union of stable masquerade failure codes. */
export type MasqueradeErrorCode = (typeof MASQUERADE_ERROR_CODES)[keyof typeof MASQUERADE_ERROR_CODES];
