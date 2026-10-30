import type { CurrentActor } from '#services/auth/current_actor';

/** Projects the signed-in identity into the shared HTTP user shape. */
export function buildUserProjection(actor: Pick<CurrentActor, 'userId' | 'email' | 'displayName'>) {
  return {
    id: actor.userId,
    name: actor.displayName ?? undefined,
    email: actor.email,
    image: null,
  };
}
