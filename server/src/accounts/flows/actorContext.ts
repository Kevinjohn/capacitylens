import type { ActorContext } from "@capacitylens/shared/account/types";

/**
 * Maps session identity and assurance details to the actor context used by account commands.
 */
export function buildActorContextFromSession(
  input: {
    id: string;
    principal: { id: string };
    freshUntil: string | null;
    assurance: "trusted-local" | "password" | "federated";
  },
  now = Date.now(),
): ActorContext {
  return {
    principalId: input.principal.id,
    sessionId: input.id,
    assurance: input.assurance,
    fresh: input.freshUntil !== null && Date.parse(input.freshUntil) > now,
  };
}
