import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import type { ProvisionalPrincipal } from "@capacitylens/shared/account/types";
import { type Auth, type AuthMode } from "../../auth";
import type { Db } from "../../db";

export interface MasqueradeSessionLifecycle {
  prepare(sessionHandles: readonly string[], reason: "session_expired" | "session_revoked"): void;
  prepareUsers(userIds: readonly string[], reason: "session_revoked"): readonly string[];
  commit(sessionHandles: readonly string[]): void;
}

export interface LocalIdentityPort extends IdentityPort {
  /** Embedded shared-SQLite capability: commit the credential identity and its coordinator-owned
   * principal correlation as one transaction. The callback must perform synchronous writes only. */
  createCorrelatedProvisionalCredentialPrincipal(
    input: Parameters<IdentityPort["createProvisionalCredentialPrincipal"]>[0] & {
      correlatePrincipalInTransaction(principalId: string): void;
    },
  ): Promise<ProvisionalPrincipal>;
  /** Embedded-only capability used while the coordinator already owns the SQLite transaction. */
  deprovisionLocalPrincipalInTx(principalId: string, exceptCommandId?: string): readonly string[];
  /** Embedded bulk capability for workspace erasure. Verification state is classified once for
   * the whole principal set while the coordinator owns the SQLite transaction. */
  deprovisionLocalPrincipalsInTx(principalIds: readonly string[], exceptCommandId?: string): readonly string[];
  /** Publish prepared in-memory session cleanup only after the caller-owned transaction commits. */
  commitMasqueradeSessionEnds(sessionHandles: readonly string[]): void;
}

/** Embedded identity capabilities used by cutover inspection, activation, and exact repair. */
export interface SsoCutoverIdentityPort extends LocalIdentityPort {
  /** Run all synchronous identity/workspace inventory reads from one SQLite snapshot. */
  readSsoCutoverSnapshot<Result>(read: () => Result): Result;
  inspectProviderLinks(
    principalId: string,
    providerId: string,
  ): readonly {
    rowId: string;
    subject: string;
    verified: boolean;
  }[];
  inspectSsoCutover(providerId: string): SsoCutoverIdentityFacts;
  /** Reconfirm readiness and, when necessary, seal the SSO boundary while holding one SQLite
   * writer reservation. The callback must be synchronous and may perform nested snapshot reads. */
  revokeAllForSsoCutover(assertReady: () => void): Promise<{ sessions: number; ceremonies: number }>;
  correctPrincipalEmail(input: {
    principalId: string;
    email: string;
    audit: AccountAuditEvent;
    authorizeInTransaction(): void;
  }): Promise<void>;
  removeFederatedLink(input: FederatedLinkRemoval & { authorizeInTransaction(): void }): Promise<boolean>;
  /** Stopped-server operator repair may remove the final unusable provider row. This capability is
   * intentionally separate from the live administration path, which must preserve sign-in. */
  removeFederatedLinkForStoppedRepair(input: FederatedLinkRemoval): Promise<boolean>;
}

export interface FederatedLinkRemoval {
  principalId: string;
  providerId: string;
  rowId: string;
  subject: string;
  audit: AccountAuditEvent;
}

/** Immutable identity-side inventory consumed by the pure cutover readiness evaluator. */
export interface SsoCutoverIdentityFacts {
  principals: readonly {
    id: string;
    email: string;
    displayName: string | null;
    providerIds: readonly string[];
  }[];
  requiredProviderLinks: readonly {
    rowId: string;
    principalId: string;
    subject: string;
    verified: boolean;
  }[];
  alternativeProviderLinks: readonly {
    rowId: string;
    principalId: string;
    providerId: string;
    subject: string;
  }[];
  outstandingResetPrincipalIds: readonly string[];
}
export interface IdentityTableProbes {
  accountTableExists(db: Db): boolean;
  sessionTableExists(db: Db): boolean;
  userTableExists(db: Db): boolean;
  verificationTableExists(db: Db): boolean;
  twoFactorTableExists(db: Db): boolean;
  federatedLinkObservationsTableExists(db: Db): boolean;
  federatedLinkCeremoniesTableExists(db: Db): boolean;
  accountSessionAssuranceTableExists(db: Db): boolean;
}
export type IdentityPortInput = {
  applicationId: string;
  auth: Auth;
  authMode: Exclude<AuthMode, "off">;
  db: Db;
  publicBaseUrl?: string;
  masqueradeSessions?: MasqueradeSessionLifecycle;
};
export interface IdentityPortContext extends IdentityTableProbes {
  input: IdentityPortInput;
  makeCompensationHandle(principalId: string, commandId: string): string;
  assertCompensationHandle(provisional: ProvisionalPrincipal, commandId: string): void;
  revokePrincipalSessionsInTx(
    db: Db,
    applicationId: string,
    principalId: string,
    lifecycle?: MasqueradeSessionLifecycle,
  ): readonly string[];
  eraseLocalPrincipalsInTx(
    db: Db,
    principalIds: readonly string[],
    lifecycle?: MasqueradeSessionLifecycle,
  ): readonly string[];
}
