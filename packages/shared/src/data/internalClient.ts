import { NULLABLE_FIELDS } from '../types/nullableFields.js';
import type { Client, ID, ISOTimestamp } from '../types/entities.js';

// Each account has one persisted Internal client, identified by `builtin` rather than by id.
// Ordinary writes cannot modify or duplicate it. The portable import requires exactly one
// canonical Internal client and keeps its exported id.

/** The display name of the built-in Internal client (also required on import). */
export const INTERNAL_CLIENT_NAME = 'Internal';

/** A preset swatch colour for the Internal client (Blue bright, a valid `#rrggbb` from the
 * palette, distinct from NEUTRAL_COLOR which is reserved for external resources). */
export const INTERNAL_CLIENT_COLOR = '#2d75da';

/** The deterministic id an account's Internal client is created with. Identification at runtime
 * is still by the `builtin` flag: an imported Internal client keeps its exported id, which need not
 * match this formula. */
export function internalClientIdFor(accountId: ID): ID {
  return `internal:${accountId}`;
}

/** Build the Internal client for one account: a real Client with `builtin: true`, its selected id,
 * the reserved name + colour, and the given timestamps. Ordinary creation uses the account-derived
 * default; the seed supplies fixed ids. */
export function buildInternalClient(
  accountId: ID,
  now: ISOTimestamp,
  id: ID = internalClientIdFor(accountId),
): Client {
  return {
    ...NULLABLE_FIELDS.clients,
    id,
    accountId,
    name: INTERNAL_CLIENT_NAME,
    color: INTERNAL_CLIENT_COLOR,
    builtin: true,
    createdAt: now,
    updatedAt: now,
  };
}

function isObjectValue(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/** The account's built-in Internal client, or undefined if none exists yet. Identifies it by the
 * `builtin` flag, so an imported id still matches. First match wins; seed, company creation and
 * import validation guarantee at most one per account. */
export function internalClientFor(clients: Client[], accountId: ID): Client | undefined {
  return clients.find(
    (client) => isObjectValue(client) && isBuiltinClient(client) && client.accountId === accountId,
  );
}

/** True when this client is the protected built-in (cannot be renamed or deleted). */
export function isBuiltinClient(client: Pick<Client, 'builtin'>): boolean {
  return client.builtin === true;
}
