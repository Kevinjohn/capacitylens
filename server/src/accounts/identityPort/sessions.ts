import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import { verifyApplicationSession } from "./applicationSessionVerification";
import { createSessionLifecycle } from "./sessionLifecycle";

type SessionsContext = Pick<IdentityPortContext, "input" | "accountTableExists" | "revokePrincipalSessionsInTx">;
type SessionsPort = Pick<
  SsoCutoverIdentityPort,
  "verifyApplicationSession" | "signOut" | "listSessions" | "revokeOwnSession" | "revokePrincipalSessions"
>;

/** Composes application-session verification with provider-session lifecycle operations. */
export function createSessions(context: SessionsContext): SessionsPort {
  return {
    verifyApplicationSession: (request) =>
      verifyApplicationSession({ input: context.input, accountTableExists: context.accountTableExists }, request),
    ...createSessionLifecycle(context),
  };
}
