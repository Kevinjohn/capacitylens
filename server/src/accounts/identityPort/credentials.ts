import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import { createCredentialPrincipals } from "./credentialPrincipals";
import { createPasswordReset } from "./passwordReset";

type CredentialsPort = Pick<
  SsoCutoverIdentityPort,
  | "createProvisionalCredentialPrincipal"
  | "createCorrelatedProvisionalCredentialPrincipal"
  | "compensateProvisionalPrincipal"
  | "deprovisionLocalPrincipal"
  | "issuePasswordReset"
  | "revokePasswordResetCeremony"
>;

/** Composes local credential-principal operations and password-reset lifecycle operations. */
export function createCredentials(
  context: Pick<
    IdentityPortContext,
    "input" | "createCompensationHandle" | "assertCompensationHandle" | "eraseLocalPrincipalsInTx"
  >,
): CredentialsPort {
  return { ...createCredentialPrincipals(context), ...createPasswordReset(context.input) };
}
