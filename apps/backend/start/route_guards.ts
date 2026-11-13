import { sensitive } from '@kevinjohn/adonisjs-masquerade/http';
import { middleware } from '#start/kernel';

/**
 * A company or product route. It runs as the viewed-as member while a view-as mode is active, and
 * the Masquerade package refuses every write then.
 */
export const asMember = () => [middleware.auth({ guards: ['web_effective'] })];

/** A member route that is refused outright, reads included, while a view-as mode is active. */
export const asMemberOnly = () => [...asMember(), sensitive()];

/** A view-as control. It always runs as the signed-in person. */
export const asSignedInPerson = () => [middleware.auth({ guards: ['web'] })];

/**
 * A route about the signed-in person's own account. It answers a signed-out caller itself and is
 * refused while a view-as mode is active.
 */
export const asOwnAccount = () => [middleware.accountKitAccountBlocker()];
