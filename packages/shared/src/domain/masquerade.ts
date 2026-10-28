import type { IsoInstant, PrincipalId, Role, WorkspaceId } from "../account/types.js";

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

/** Legacy-compatible reason labels accepted by existing masquerade controls. */
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
  expiresAt: IsoInstant;
  /** Package context proof used to admit requests captured in this active mode. */
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

/** Identity-wide mode status plus the proof for requests captured in that context. */
export type MasqueradeStatus =
  { active: false; contextToken: string | null } | ({ active: true; contextToken: string } & MasqueradeState);

/** Stable machine-readable failures shared by server guards and browser recovery. */
export const MASQUERADE_ERROR_CODES = {
  active: "MASQUERADE_ACTIVE",
  readOnly: "MASQUERADE_READ_ONLY",
  ended: "MASQUERADE_ENDED",
  contextRequired: "MASQUERADE_CONTEXT_REQUIRED",
  contextChanged: "MASQUERADE_CONTEXT_CHANGED",
} as const;

/** Union of stable masquerade failure codes. */
export type MasqueradeErrorCode = (typeof MASQUERADE_ERROR_CODES)[keyof typeof MASQUERADE_ERROR_CODES];
