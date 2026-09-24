import { constants, DatabaseSync } from "node:sqlite";
import type { SsoCutoverAccountAdminPort } from "./accounts/adminPort/contracts";
import type { SsoCutoverIdentityPort } from "./accounts/identityPort/contracts";
import type { assertAccountControlPlaneCurrent } from "./accounts/sqliteAccountAdminPort";
import type { evaluateCompanyProviderCutoverReadiness } from "./accounts/companyProviderReadiness";
import type { evaluateSsoCutoverReadiness } from "./accounts/ssoCutover";
import type { Auth, AuthProviderInfo } from "./authConfig/authTypes";
import type { assertAuditOutboxCurrent } from "./auditOutbox";
import type { assertFederatedIdentitySchemaCurrent } from "./auth";
import type { mixedModeCutoverContext } from "./cutoverContext";
import type { planDatabaseMigrations } from "./db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ContextFixture = Awaited<ReturnType<typeof mixedModeCutoverContext>>;

const dependencies = vi.hoisted(() => ({
  assertAccountControlPlaneCurrent: vi.fn<typeof assertAccountControlPlaneCurrent>(),
  assertAuditOutboxCurrent: vi.fn<typeof assertAuditOutboxCurrent>(),
  assertFederatedIdentitySchemaCurrent: vi.fn<typeof assertFederatedIdentitySchemaCurrent>(),
  mixedModeCutoverContext: vi.fn<typeof mixedModeCutoverContext>(),
  planDatabaseMigrations: vi.fn<typeof planDatabaseMigrations>(),
  evaluateCompanyProviderCutoverReadiness: vi.fn<typeof evaluateCompanyProviderCutoverReadiness>(),
  evaluateSsoCutoverReadiness: vi.fn<typeof evaluateSsoCutoverReadiness>(),
}));

vi.mock("./accounts/sqliteAccountAdminPort", () => ({
  assertAccountControlPlaneCurrent: dependencies.assertAccountControlPlaneCurrent,
}));
vi.mock("./accounts/companyProviderReadiness", () => ({
  evaluateCompanyProviderCutoverReadiness: dependencies.evaluateCompanyProviderCutoverReadiness,
}));
vi.mock("./accounts/ssoCutover", () => ({
  evaluateSsoCutoverReadiness: dependencies.evaluateSsoCutoverReadiness,
}));
vi.mock("./auditOutbox", () => ({ assertAuditOutboxCurrent: dependencies.assertAuditOutboxCurrent }));
vi.mock("./auth", () => ({ assertFederatedIdentitySchemaCurrent: dependencies.assertFederatedIdentitySchemaCurrent }));
vi.mock("./cutoverContext", () => ({ mixedModeCutoverContext: dependencies.mixedModeCutoverContext }));
vi.mock("./db", () => ({ planDatabaseMigrations: dependencies.planDatabaseMigrations }));

import { inspectSsoCutoverPreflight } from "./cutoverPreflight";

const provider = {
  id: "google",
  label: "Google",
  kind: "social",
  experimental: false,
} satisfies AuthProviderInfo;
const otherProvider = { ...provider, id: "microsoft", label: "Microsoft" } satisfies AuthProviderInfo;
const environment = { DISTINCTIVE_PREFLIGHT_ENVIRONMENT: "forwarded" };
const identityFacts = {
  principals: [{ id: "owner-1", email: "owner@example.com", displayName: "Bruce Wayne", providerIds: [provider.id] }],
  requiredProviderLinks: [{ rowId: "link-1", principalId: "owner-1", subject: "provider-subject", verified: true }],
  alternativeProviderLinks: [],
  outstandingResetPrincipalIds: [],
};
const workspaceFacts = [
  {
    workspaceId: "workspace-1",
    workspaceName: "Wayne Enterprises",
    members: [{ principalId: "owner-1", role: "owner" as const, status: "active" as const }],
  },
];

function unused(): never {
  throw new Error("Unused fixture operation was called.");
}

async function unusedAsync(): Promise<never> {
  return unused();
}

const identity: SsoCutoverIdentityPort = {
  verifyApplicationSession: unusedAsync,
  getPrincipalSummaries: unusedAsync,
  findPrincipalByFederatedSubject: unusedAsync,
  signOut: unusedAsync,
  listSessions: unusedAsync,
  revokeOwnSession: unusedAsync,
  createProvisionalCredentialPrincipal: unusedAsync,
  compensateProvisionalPrincipal: unusedAsync,
  deprovisionLocalPrincipal: unusedAsync,
  issuePasswordReset: unusedAsync,
  revokePasswordResetCeremony: unusedAsync,
  revokePrincipalSessions: unusedAsync,
  createCorrelatedProvisionalCredentialPrincipal: unusedAsync,
  deprovisionLocalPrincipalInTx: unused,
  deprovisionLocalPrincipalsInTx: unused,
  commitMasqueradeSessionEnds: unused,
  readSsoCutoverSnapshot: (read) => read(),
  inspectProviderLinks: unused,
  inspectSsoCutover: () => identityFacts,
  revokeAllForSsoCutover: unusedAsync,
  correctPrincipalEmail: unusedAsync,
  removeFederatedLink: unusedAsync,
  removeFederatedLinkForStoppedRepair: unusedAsync,
};

const administration: SsoCutoverAccountAdminPort = {
  listWorkspacesForPrincipal: unusedAsync,
  getMembership: unusedAsync,
  listMemberships: unusedAsync,
  listInvitations: unusedAsync,
  previewInvitation: unusedAsync,
  preparePasswordInvitationClaim: unusedAsync,
  createInvitation: unusedAsync,
  acceptInvitation: unusedAsync,
  claimInvitationForPrincipal: unusedAsync,
  revokeInvitation: unusedAsync,
  changeMemberRole: unusedAsync,
  changeMemberStatus: unusedAsync,
  removeMember: unusedAsync,
  readOwnershipTransfer: unusedAsync,
  initiateOwnershipTransfer: unusedAsync,
  acceptOwnershipTransfer: unusedAsync,
  withdrawOwnershipTransfer: unusedAsync,
  declineOwnershipTransfer: unusedAsync,
  cancelOwnershipTransfer: unusedAsync,
  completeOwnershipTransfer: unusedAsync,
  evaluateIdentityAdminAuthority: unusedAsync,
  evaluateIdentityAdminAuthorities: unusedAsync,
  evaluateIdentityAdminAuthoritiesForTargets: unusedAsync,
  confirmIdentityAdminAuthority: unusedAsync,
  roleForPrincipalInWorkspace: unused,
  workspacePrincipalIds: unused,
  projectIdentityAdminAuthoritiesForTargets: unused,
  evaluateWorkspaceProvisioningAuthorityInTx: unused,
  provisionOwnerMembershipInTx: unused,
  assertWorkspaceErasureAuthorityInTx: unused,
  eraseWorkspaceAdministrationInTx: unused,
  inspectSsoCutoverWorkspaces: () => workspaceFacts,
  assertIdentityRepairAuthorityInTx: unused,
  repairOwnerlessWorkspaceInTx: unused,
};

const auth = {
  handler: unusedAsync,
  api: {
    getSession: unusedAsync,
    requestPasswordReset: unusedAsync,
  },
  options: {} as Auth["options"],
  providers: [otherProvider, provider],
  federatedIssuers: new Map([[provider.id, "https://accounts.google.com"]]),
  defaultCompanyProvider: provider,
  ensureProviderBindings: unused,
  assertProviderBindings: unused,
  createCredentialUser: unusedAsync,
  deleteCredentialUser: unusedAsync,
  revokeUserSessions: unusedAsync,
} satisfies Auth;

const readiness = { ready: true, provider, workspaces: [], issues: [] };
const authoritativeReadiness = { ready: true, issues: [] };

function createContext(openSignup: string | undefined): ContextFixture {
  return {
    provider,
    auth,
    identity,
    administration,
    resolvedEnvironment: {
      env: { SMALLSASS_ACCOUNT_ALLOW_OPEN_SIGNUP: openSignup },
      profile: "self-hosted-mixed",
    },
  };
}

const staleAssertions = [
  {
    name: "account control plane",
    assertion: dependencies.assertAccountControlPlaneCurrent,
    message: "account control plane is stale",
    accounts: 1,
    audit: 0,
    identity: 0,
  },
  {
    name: "audit outbox",
    assertion: dependencies.assertAuditOutboxCurrent,
    message: "audit outbox is stale",
    accounts: 1,
    audit: 1,
    identity: 0,
  },
  {
    name: "federated identity schema",
    assertion: dependencies.assertFederatedIdentitySchemaCurrent,
    message: "identity schema is stale",
    accounts: 1,
    audit: 1,
    identity: 1,
  },
];

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  vi.resetAllMocks();
  dependencies.planDatabaseMigrations.mockReturnValue({ fromVersion: 33, toVersion: 34, fresh: false, migrations: [] });
  dependencies.mixedModeCutoverContext.mockImplementation(async () => createContext(undefined));
  dependencies.evaluateSsoCutoverReadiness.mockReturnValue(readiness);
  dependencies.evaluateCompanyProviderCutoverReadiness.mockReturnValue(authoritativeReadiness);
});

afterEach(() => db.close());

describe("inspectSsoCutoverPreflight refusals", () => {
  it("refuses pending migrations before creating the cutover context", async () => {
    dependencies.planDatabaseMigrations.mockReturnValue({
      fromVersion: 33,
      toVersion: 34,
      fresh: false,
      migrations: [{ version: 34, name: "current", checksum: "checksum" }],
    });

    await expect(inspectSsoCutoverPreflight(db, environment)).rejects.toThrow(
      "Database schema v33 is not current (expected v34); start this release normally before preflight.",
    );

    expect(dependencies.planDatabaseMigrations).toHaveBeenCalledWith(db);
    expect(dependencies.mixedModeCutoverContext).not.toHaveBeenCalled();
    expect(dependencies.assertAccountControlPlaneCurrent).not.toHaveBeenCalled();
    expect(dependencies.assertAuditOutboxCurrent).not.toHaveBeenCalled();
    expect(dependencies.assertFederatedIdentitySchemaCurrent).not.toHaveBeenCalled();
    expect(dependencies.evaluateSsoCutoverReadiness).not.toHaveBeenCalled();
  });

  it.each(staleAssertions)(
    "surfaces a stale $name assertion before evaluating readiness",
    async ({ assertion, message, accounts, audit, identity }) => {
      assertion.mockImplementation(() => {
        throw new Error(message);
      });

      await expect(inspectSsoCutoverPreflight(db, environment)).rejects.toThrow(message);

      expect(dependencies.planDatabaseMigrations).toHaveBeenCalledWith(db);
      expect(dependencies.mixedModeCutoverContext).toHaveBeenCalledWith(db, environment);
      expect(dependencies.assertAccountControlPlaneCurrent).toHaveBeenCalledTimes(accounts);
      expect(dependencies.assertAuditOutboxCurrent).toHaveBeenCalledTimes(audit);
      expect(dependencies.assertFederatedIdentitySchemaCurrent).toHaveBeenCalledTimes(identity);
      expect(dependencies.evaluateSsoCutoverReadiness).not.toHaveBeenCalled();
    },
  );

  it("does not call later assertions after the audit outbox refusal", async () => {
    dependencies.assertAuditOutboxCurrent.mockImplementation(() => {
      throw new Error("audit outbox is stale");
    });

    await expect(inspectSsoCutoverPreflight(db, environment)).rejects.toThrow("audit outbox is stale");

    expect(dependencies.assertAccountControlPlaneCurrent).toHaveBeenCalledWith(db);
    expect(dependencies.assertFederatedIdentitySchemaCurrent).not.toHaveBeenCalled();
    expect(dependencies.evaluateSsoCutoverReadiness).not.toHaveBeenCalled();
  });
});

// The retained preflight cases share one named-provider context and call-order fixture.
// eslint-disable-next-line max-lines-per-function
describe("inspectSsoCutoverPreflight valid context", () => {
  it("reports the same company-provider cutover refusal as startup", async () => {
    dependencies.evaluateCompanyProviderCutoverReadiness.mockReturnValue({
      ready: false,
      issues: [
        {
          reason: "principal_not_connected",
          message: "Bruce Wayne has no verified Google or Microsoft connection.",
          blocking: true,
          principalId: "former-1",
          workspaceId: null,
        },
      ],
    });
    const result = await inspectSsoCutoverPreflight(db, environment);
    expect(result.ready).toBe(false);
    expect(result.issues.map(({ reason }) => reason)).toEqual(["principal_not_connected"]);
    expect(result.issues[0]?.message).toContain("verified");
  });

  it("reports open password signup with a stable reason and readable message", async () => {
    dependencies.mixedModeCutoverContext.mockImplementation(async () => createContext("1"));

    const result = await inspectSsoCutoverPreflight(db, environment);

    expect(result.ready).toBe(false);
    expect(result.issues.map(({ reason }) => reason)).toContain("open_signup_enabled");
    expect(result.issues.find(({ reason }) => reason === "open_signup_enabled")?.message).toContain(
      "Open password signup",
    );
  });

  it("surfaces unexpected identity inspection errors", async () => {
    const failure = new Error("identity inspection failed");
    dependencies.evaluateCompanyProviderCutoverReadiness.mockImplementation(() => {
      throw failure;
    });

    await expect(inspectSsoCutoverPreflight(db, environment)).rejects.toBe(failure);
  });

  it("keeps detailed diagnostics for a single named provider", async () => {
    dependencies.mixedModeCutoverContext.mockImplementation(async () => ({
      ...createContext(undefined),
      auth: { ...auth, providers: [provider] },
    }));
    const result = await inspectSsoCutoverPreflight(db, environment);
    expect(result.ready).toBe(true);
    expect(result.diagnostics).toEqual([readiness]);
    expect(dependencies.evaluateSsoCutoverReadiness).toHaveBeenCalledWith({
      provider,
      providers: [provider],
      identity: identityFacts,
      workspaces: workspaceFacts,
      openSignup: false,
    });
  });

  it("keeps stricter legacy repair diagnostics separate from authoritative readiness", async () => {
    dependencies.evaluateSsoCutoverReadiness.mockReturnValue({
      ...readiness,
      ready: false,
      issues: [
        {
          reason: "alternative_provider_linked",
          message: "An existing repair detail requiring attention.",
          blocking: true,
          critical: true,
          workspaceId: null,
          principalId: "owner-1",
        },
      ],
    });

    const result = await inspectSsoCutoverPreflight(db, environment);

    expect(result.ready).toBe(true);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.ready).toBe(false);
  });

  it.each([
    ["1", true],
    ["0", false],
    [undefined, false],
  ])("maps a valid context with open signup %s", async (openSignup, expectedOpenSignup) => {
    dependencies.mixedModeCutoverContext.mockImplementation(async () => createContext(openSignup));

    await expect(inspectSsoCutoverPreflight(db, environment)).resolves.toMatchObject({
      ready: !expectedOpenSignup,
      providers: [otherProvider, provider],
      diagnostics: [readiness, readiness],
    });

    expect(dependencies.assertAccountControlPlaneCurrent).toHaveBeenCalledWith(db);
    expect(dependencies.assertAuditOutboxCurrent).toHaveBeenCalledWith(db);
    expect(dependencies.assertFederatedIdentitySchemaCurrent).toHaveBeenCalledWith(db);
    expect(dependencies.evaluateCompanyProviderCutoverReadiness).toHaveBeenCalledWith({
      providerIds: new Set([otherProvider.id, provider.id]),
      providerSnapshots: [
        { providerId: otherProvider.id, provider: otherProvider, identity: identityFacts },
        { providerId: provider.id, provider, identity: identityFacts },
      ],
      workspaces: workspaceFacts,
    });
    expect(dependencies.evaluateSsoCutoverReadiness).toHaveBeenCalledTimes(2);
    const callOrder = [
      dependencies.planDatabaseMigrations,
      dependencies.mixedModeCutoverContext,
      dependencies.assertAccountControlPlaneCurrent,
      dependencies.assertAuditOutboxCurrent,
      dependencies.assertFederatedIdentitySchemaCurrent,
      dependencies.evaluateCompanyProviderCutoverReadiness,
    ].map((mock) => {
      const order = mock.mock.invocationCallOrder[0];
      if (order === undefined) throw new Error("Expected preflight dependency to be called.");
      return order;
    });
    expect(callOrder).toEqual([...callOrder].sort((left, right) => left - right));
  });

  it("does not authorize any database operation while inspecting a valid context", async () => {
    const authorizationEvents: number[] = [];
    db.setAuthorizer((action) => {
      authorizationEvents.push(action);
      return constants.SQLITE_DENY;
    });

    await expect(inspectSsoCutoverPreflight(db, environment)).resolves.toMatchObject({ ready: true });

    expect(authorizationEvents).toEqual([]);
  });
});
