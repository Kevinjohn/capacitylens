import { constants, DatabaseSync } from "node:sqlite";
import type { SsoCutoverAccountAdminPort } from "./accounts/adminPort/contracts";
import type { SsoCutoverIdentityPort } from "./accounts/identityPort/contracts";
import type { assertAccountControlPlaneCurrent } from "./accounts/sqliteAccountAdminPort";
import type { ssoCutoverReadiness } from "./accounts/ssoCutover";
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
  ssoCutoverReadiness: vi.fn<typeof ssoCutoverReadiness>(),
}));

vi.mock("./accounts/sqliteAccountAdminPort", () => ({
  assertAccountControlPlaneCurrent: dependencies.assertAccountControlPlaneCurrent,
}));
vi.mock("./accounts/ssoCutover", () => ({ ssoCutoverReadiness: dependencies.ssoCutoverReadiness }));
vi.mock("./auditOutbox", () => ({ assertAuditOutboxCurrent: dependencies.assertAuditOutboxCurrent }));
vi.mock("./auth", () => ({ assertFederatedIdentitySchemaCurrent: dependencies.assertFederatedIdentitySchemaCurrent }));
vi.mock("./cutoverContext", () => ({ mixedModeCutoverContext: dependencies.mixedModeCutoverContext }));
vi.mock("./db", () => ({ planDatabaseMigrations: dependencies.planDatabaseMigrations }));

import { inspectSsoCutoverPreflight } from "./cutoverPreflight";

const provider = {
  id: "workforce",
  label: "Wayne Enterprises",
  kind: "oidc",
  experimental: false,
} satisfies AuthProviderInfo;
const otherProvider = { ...provider, id: "partner", label: "Stark Industries" } satisfies AuthProviderInfo;
const environment = { DISTINCTIVE_PREFLIGHT_ENVIRONMENT: "forwarded" };

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
  inspectSsoCutover: unused,
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
  transferOwnership: unusedAsync,
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
  inspectSsoCutoverWorkspaces: unused,
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
  federatedIssuers: new Map([[provider.id, "https://identity.wayne.example"]]),
  strictProvider: provider,
  ensureProviderBindings: unused,
  assertProviderBindings: unused,
  createCredentialUser: unusedAsync,
  deleteCredentialUser: unusedAsync,
  revokeUserSessions: unusedAsync,
} satisfies Auth;

const readiness = { ready: true, provider, workspaces: [], issues: [] };

function createContext(openSignup: string | undefined): ContextFixture {
  return {
    provider,
    auth,
    identity,
    administration,
    resolvedEnvironment: {
      env: { CAPACITYLENS_ALLOW_OPEN_SIGNUP: openSignup },
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
  dependencies.ssoCutoverReadiness.mockReturnValue(readiness);
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
    expect(dependencies.ssoCutoverReadiness).not.toHaveBeenCalled();
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
      expect(dependencies.ssoCutoverReadiness).not.toHaveBeenCalled();
    },
  );

  it("does not call later assertions after the audit outbox refusal", async () => {
    dependencies.assertAuditOutboxCurrent.mockImplementation(() => {
      throw new Error("audit outbox is stale");
    });

    await expect(inspectSsoCutoverPreflight(db, environment)).rejects.toThrow("audit outbox is stale");

    expect(dependencies.assertAccountControlPlaneCurrent).toHaveBeenCalledWith(db);
    expect(dependencies.assertFederatedIdentitySchemaCurrent).not.toHaveBeenCalled();
    expect(dependencies.ssoCutoverReadiness).not.toHaveBeenCalled();
  });
});

describe("inspectSsoCutoverPreflight valid context", () => {
  it.each([
    ["1", true],
    ["0", false],
    [undefined, false],
  ])("maps a valid context with open signup %s", async (openSignup, expectedOpenSignup) => {
    dependencies.mixedModeCutoverContext.mockImplementation(async () => createContext(openSignup));

    await expect(inspectSsoCutoverPreflight(db, environment)).resolves.toBe(readiness);

    expect(dependencies.assertAccountControlPlaneCurrent).toHaveBeenCalledWith(db);
    expect(dependencies.assertAuditOutboxCurrent).toHaveBeenCalledWith(db);
    expect(dependencies.assertFederatedIdentitySchemaCurrent).toHaveBeenCalledWith(db);
    expect(dependencies.ssoCutoverReadiness).toHaveBeenCalledWith({
      provider,
      providers: [otherProvider, provider],
      identity,
      administration,
      openSignup: expectedOpenSignup,
    });
    const callOrder = [
      dependencies.planDatabaseMigrations,
      dependencies.mixedModeCutoverContext,
      dependencies.assertAccountControlPlaneCurrent,
      dependencies.assertAuditOutboxCurrent,
      dependencies.assertFederatedIdentitySchemaCurrent,
      dependencies.ssoCutoverReadiness,
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

    await expect(inspectSsoCutoverPreflight(db, environment)).resolves.toBe(readiness);

    expect(authorizationEvents).toEqual([]);
  });
});
