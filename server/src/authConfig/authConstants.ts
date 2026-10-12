import {
  ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS,
  ACCOUNT_SESSION_FRESH_AGE_SECONDS,
} from "@capacitylens/shared/account/sessionPolicy";

/** Admin reset links remain valid for 24 hours so a colleague need not redeem them immediately.
 * The bearer is single-use and outlives the default invitation lifetime, though an invitation can have a shorter requested expiry.
 */
export const RESET_LINK_TTL_SECONDS = 60 * 60 * 24;
/** A session can never outlive this wall-clock duration, regardless of activity. */
export const SESSION_ABSOLUTE_TTL_SECONDS = ACCOUNT_SESSION_ABSOLUTE_TTL_SECONDS;
/** Maximum age of a sign-in accepted for fresh-session administrative actions. */
export const SESSION_FRESH_AGE_SECONDS = ACCOUNT_SESSION_FRESH_AGE_SECONDS;
/** Re-authentication is required after this much server-observed inactivity. */
export const SESSION_INACTIVITY_TTL_SECONDS = 30 * 60;
/** Bound session activity writes while keeping idle expiry accurate to within one minute. */
export const SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

/** Reserved index enforcing one principal for each external provider subject. */
export const FEDERATED_SUBJECT_UNIQUE_INDEX = "idx_account_provider_subject_unique";
/** Reserved index enforcing one subject per provider for each local principal. */
export const FEDERATED_PRINCIPAL_PROVIDER_UNIQUE_INDEX = "idx_account_principal_provider_unique";
/** Reserved trigger that atomically records newly admitted external provider rows. */
export const FEDERATED_OBSERVATION_TRIGGER = "capacitylens_observe_federated_account";

/** Better Auth signs sessions/cookies with CAPACITYLENS_SECRET. A short secret is
 * brute-forceable, so refuse anything weaker than this. (Better Auth's own guidance and
 * generators emit 32+ char secrets.) */
export const MIN_BETTER_AUTH_SECRET_LENGTH = 32;
