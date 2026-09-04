import {
  ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS,
  ACCOUNT_SESSION_FRESH_AGE_SECONDS,
} from "@capacitylens/shared/account/sessionPolicy";

/** Reset links are admin-minted and handed over out-of-band (Slack/chat), so the 1-hour Better
 *  Auth default is too tight — the recipient may not be at a keyboard. 24h matches the "share a
 *  link with a colleague" reality while staying far below the invite TTL (an invite grants entry;
 *  a reset link grants an EXISTING identity, so it stays the shorter-lived of the two). */
export const RESET_LINK_TTL_SECONDS = 60 * 60 * 24;
/** A session can never outlive this wall-clock duration, regardless of activity. */
export const SESSION_ABSOLUTE_TTL_SECONDS = ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS;
export const SESSION_FRESH_AGE_SECONDS = ACCOUNT_SESSION_FRESH_AGE_SECONDS;
/** Re-authentication is required after this much server-observed inactivity. */
export const SESSION_INACTIVITY_TTL_SECONDS = 30 * 60;
/** Bound session activity writes while keeping idle expiry accurate to within one minute. */
export const SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

/** Reserved v25 index enforcing one principal for each external provider subject. */
export const FEDERATED_SUBJECT_UNIQUE_INDEX = "idx_account_provider_subject_unique";
/** Reserved v25 index enforcing one subject per provider for each local principal. */
export const FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX = "idx_account_principal_provider_unique";
/** Reserved v25 trigger that atomically records newly admitted external provider rows. */
export const FEDERATED_OBSERVATION_TRIGGER = "capacitylens_observe_federated_account";

/** Better Auth signs sessions/cookies with BETTER_AUTH_SECRET — a short secret is
 *  brute-forceable, so refuse anything weaker than this. (Better Auth's own guidance and
 *  generators emit 32+ char secrets.) */
export const MIN_BETTER_AUTH_SECRET_LENGTH = 32;
