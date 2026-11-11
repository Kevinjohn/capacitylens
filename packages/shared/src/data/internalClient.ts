import { NULLABLE_FIELDS } from '../types/nullableFields.js';
import type { Client, ID, ISOTimestamp } from '../types/entities.js';

// Each account has one persisted Internal client, identified by `builtin` because import remapping changes IDs.
// Public CRUD strips the flag, imports reconcile duplicates, and server writes reject a second built-in client.

/** The display name of the built-in Internal client (also recognised on import). */
export const INTERNAL_CLIENT_NAME = 'Internal';

/** A preset swatch colour for the Internal client (Blue bright, a valid `#rrggbb` from the
 * palette, distinct from NEUTRAL_COLOR which is reserved for external resources). */
export const INTERNAL_CLIENT_COLOR = '#2d75da';

/** The deterministic id an account's Internal client is created with. Identification at runtime
 * is still by the `builtin` flag. This formula never survives an import-remap (see the module doc). */
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
 * `builtin` flag (id-independent so it survives import-remap). First match wins; seed,
 * addAccount and imports guarantee at most one per account. */
export function internalClientFor(clients: Client[], accountId: ID): Client | undefined {
  return clients.find(
    (client) => isObjectValue(client) && isBuiltinClient(client) && client.accountId === accountId,
  );
}

/** True when this client is the protected built-in (cannot be renamed or deleted). */
export function isBuiltinClient(client: Pick<Client, 'builtin'>): boolean {
  return client.builtin === true;
}
