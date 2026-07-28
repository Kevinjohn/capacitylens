import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { AccountAuditPort, AccountFlowOperation, IdentityPort } from "@capacitylens/shared/account/ports";
import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type {
  ActorContext,
  ApplicationSession,
  IdentityAdminAuthorityDecision,
  Membership,
  PasswordResetCeremony,
} from "@capacitylens/shared/account/types";
import { openDb, type Db } from "../../db";
import type { LocalIdentityPort } from "../betterAuthIdentityPort";
import { localAccountFlows } from "../localAccountFlows";
import { KeyedOperationLock } from "../operationLock";
import type { LocalAccountAdminPort } from "../sqliteAccountAdminPort";
import { finishAccountCommand, reserveAccountCommand } from "../state";
import { WRITE_ONCE_SECRET_REPLAY_WINDOW_MS } from "../writeOnceSecretReplay";

const command = { commandId: "command-1", idempotencyKey: "idempotency-1" };
const actor: ActorContext = {
  principalId: "actor-1",
  sessionId: "session-1",
  assurance: "mfa",
  fresh: true,
  mfaSatisfied: true,
};
const member: Membership = {
  workspaceId: "workspace-1",
  principalId: "principal-1",
  role: "editor",
  status: "active",
  joinedAt: "2026-01-01T00:00:00.000Z",
  membershipRevision: "1",
  policyVersion: "account-policy-v1",
};
const session: ApplicationSession = {
  id: "session-1",
  principal: {
    id: "actor-1",
    displayName: "Actor",
    email: "actor@example.com",
    emailVerified: true,
    linkedSubject: null,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-01T12:00:00.000Z",
  freshUntil: "2026-01-01T00:15:00.000Z",
  assurance: "mfa",
};

function contractError(code: ConstructorParameters<typeof AccountContractError>[0]["code"]) {
  return new AccountContractError({ code, message: code, retryable: false });
}

function identityPort(overrides: Partial<LocalIdentityPort> = {}): LocalIdentityPort {
  const base: LocalIdentityPort = {
    deprovisionLocalPrincipalInTx: vi.fn(),
    deprovisionLocalPrincipalsInTx: vi.fn(),
    verifyApplicationSession: vi.fn(async () => session),
    getPrincipalSummaries: vi.fn(async () => []),
    findPrincipalByFederatedSubject: vi.fn(async () => null),
    signOut: vi.fn(async () => ({ setCookies: [] })),
    listSessions: vi.fn(async () => []),
    revokeOwnSession: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: "2026-01-01T00:00:00.000Z",
    })),
    createProvisionalCredentialPrincipal: vi.fn(async ({ command: value }) => ({
      principalId: "principal-1",
      compensationHandle: `opaque-${value.commandId}`,
    })),
    createCorrelatedProvisionalCredentialPrincipal: vi.fn(
      async ({ command: value, correlatePrincipalInTransaction }) => {
        correlatePrincipalInTransaction("principal-1");
        return {
          principalId: "principal-1",
          compensationHandle: `opaque-${value.commandId}`,
        };
      },
    ),
    compensateProvisionalPrincipal: vi.fn(async () => {}),
    deprovisionLocalPrincipal: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: "2026-01-01T00:00:00.000Z",
    })),
    issuePasswordReset: vi.fn(async () => ({
      ceremonyId: "ceremony-1",
      token: "write-once-reset-token",
      expiresAt: "2026-01-02T00:00:00.000Z",
    })),
    revokePasswordResetCeremony: vi.fn(async () => {}),
    revokePrincipalSessions: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
  const create = overrides.createProvisionalCredentialPrincipal ?? base.createProvisionalCredentialPrincipal;
  return {
    ...base,
    ...overrides,
    createCorrelatedProvisionalCredentialPrincipal:
      overrides.createCorrelatedProvisionalCredentialPrincipal ??
      vi.fn(async (input) => {
        const provisional = await create(input);
        input.correlatePrincipalInTransaction(provisional.principalId);
        return provisional;
      }),
  };
}

function administrationPort(overrides: Partial<LocalAccountAdminPort> = {}): LocalAccountAdminPort {
  const base: LocalAccountAdminPort = {
    roleForPrincipalInWorkspace: vi.fn(() => null),
    workspacePrincipalIds: vi.fn(() => []),
    evaluateWorkspaceProvisioningAuthorityInTx: vi.fn(() => ({
      allowed: true as const,
    })),
    provisionOwnerMembershipInTx: vi.fn(({ workspaceId, principalId, joinedAt }) => ({
      ...member,
      workspaceId,
      principalId,
      role: "owner" as const,
      joinedAt,
    })),
    assertWorkspaceErasureAuthorityInTx: vi.fn(),
    eraseWorkspaceAdministrationInTx: vi.fn(() => []),
    listWorkspacesForPrincipal: vi.fn(async () => []),
    getMembership: vi.fn(async () => member),
    listMemberships: vi.fn(async () => [member]),
    listInvitations: vi.fn(async () => []),
    previewInvitation: vi.fn(async () => ({
      workspaceName: "Workspace",
      role: "editor" as const,
      expiresAt: "2099-01-01T00:00:00.000Z",
    })),
    preparePasswordInvitationClaim: vi.fn(async () => ({
      emailVerifiedByInvitation: true,
      workspaceId: "workspace-1",
    })),
    createInvitation: vi.fn(async () => ({
      token: "write-once-invite-token",
      id: "invite-1",
      workspaceId: "workspace-1",
      role: "editor" as const,
      preauthorizedEmail: null,
      expiresAt: "2099-01-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    })),
    acceptInvitation: vi.fn(async () => member),
    claimInvitationForPrincipal: vi.fn(async () => member),
    revokeInvitation: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: "2026-01-01T00:00:00.000Z",
    })),
    changeMemberRole: vi.fn(async () => member),
    removeMember: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: "2026-01-01T00:00:00.000Z",
    })),
    transferOwnership: vi.fn(async () => ({
      previousOwner: member,
      nextOwner: member,
    })),
    evaluateIdentityAdminAuthority: vi.fn(async () => ({
      allowed: true as const,
      revision: "revision-1",
      policyVersion: "account-policy-v1",
    })),
    evaluateIdentityAdminAuthorities: vi.fn<LocalAccountAdminPort["evaluateIdentityAdminAuthorities"]>(
      async ({ actions }) =>
        new Map(
          actions.map((action) => [
            action,
            {
              allowed: true as const,
              revision: "revision-1",
              policyVersion: "account-policy-v1",
            },
          ]),
        ),
    ),
    evaluateIdentityAdminAuthoritiesForTargets: vi.fn<
      LocalAccountAdminPort["evaluateIdentityAdminAuthoritiesForTargets"]
    >(
      async ({ targetPrincipalIds, actions }) =>
        new Map(
          targetPrincipalIds.map((principalId) => [
            principalId,
            new Map(
              actions.map((action) => [
                action,
                {
                  allowed: true as const,
                  revision: "revision-1",
                  policyVersion: "account-policy-v1",
                },
              ]),
            ),
          ]),
        ),
    ),
    confirmIdentityAdminAuthority: vi.fn(async () => true),
  };
  return { ...base, ...overrides };
}

describe("AccountFlows conformance", () => {
  let db: Db | null = null;

  afterEach(() => {
    vi.useRealTimers();
    db?.close();
    db = null;
  });

  function harness(
    options: {
      identity?: LocalIdentityPort;
      administration?: LocalAccountAdminPort;
      lock?: KeyedOperationLock;
      audit?: AccountAuditPort;
      writeOnceReplayCapacity?: number;
    } = {},
  ) {
    db = openDb(":memory:");
    const identity = options.identity ?? identityPort();
    const administration = options.administration ?? administrationPort();
    const lock = options.lock ?? new KeyedOperationLock();
    const events: AccountAuditEvent[] = [];
    const audit = options.audit ?? {
      append: vi.fn((event: AccountAuditEvent) => {
        events.push(event);
        return true;
      }),
    };
    return {
      identity,
      administration,
      lock,
      audit,
      events,
      flows: localAccountFlows({
        applicationId: "conformance-application",
        db,
        identity,
        administration,
        lock,
        eraseProductWorkspaceInTx: (workspaceId) => {
          db!.prepare(`DELETE FROM accounts WHERE id = ?`).run(workspaceId);
        },
        audit,
        writeOnceReplayCapacity: options.writeOnceReplayCapacity,
      }),
    };
  }

  it("validates admission before identity creation or durable command reservation", async () => {
    const create = vi.fn<IdentityPort["createProvisionalCredentialPrincipal"]>();
    const identity = identityPort({
      createProvisionalCredentialPrincipal: create,
    });
    const administration = administrationPort({
      preparePasswordInvitationClaim: vi.fn(async () => {
        throw contractError("INVITATION_EXPIRED");
      }),
    });
    const { flows } = harness({ identity, administration });

    await expect(
      flows.acceptInviteWithPasswordSignup({
        token: "expired-token",
        email: "person@example.com",
        displayName: "Person",
        password: "not-stored-password",
        command,
      }),
    ).rejects.toMatchObject({ failure: { code: "INVITATION_EXPIRED" } });
    expect(create).not.toHaveBeenCalled();
    expect(db!.prepare(`SELECT COUNT(*) AS count FROM account_commands`).get()).toEqual({ count: 0 });
    await expect(flows.reconcileCommand({ command, operation: "invite-password-signup" })).resolves.toBeNull();
  });

  it("binds workspace-provisioning idempotency to the complete canonical product payload", async () => {
    const { flows } = harness();
    const base = {
      actor,
      workspaceId: "workspace-1",
      joinedAt: "2026-01-01T00:00:00.000Z",
      command,
      multiWorkspace: false,
      bootstrapAuthorized: false,
      provisionProductData: () => ({ id: "workspace-1", name: "First name" }),
    };

    await expect(
      flows.provisionWorkspace({
        ...base,
        canonicalProductPayload: { id: "workspace-1", name: "First name" },
      }),
    ).resolves.toMatchObject({ product: { name: "First name" } });
    await expect(
      flows.provisionWorkspace({
        ...base,
        canonicalProductPayload: { id: "workspace-1", name: "Changed name" },
      }),
    ).rejects.toMatchObject({ failure: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  it("audits a workspace-cap refusal as one denial rather than compensation", async () => {
    const { flows, events } = harness({
      administration: administrationPort({
        evaluateWorkspaceProvisioningAuthorityInTx: vi.fn(() => ({
          allowed: false as const,
          reason: "single-workspace-cap" as const,
        })),
      }),
    });

    await expect(
      flows.provisionWorkspace({
        actor,
        workspaceId: "workspace-2",
        joinedAt: "2026-01-01T00:00:00.000Z",
        command,
        multiWorkspace: false,
        bootstrapAuthorized: false,
        canonicalProductPayload: { id: "workspace-2" },
        provisionProductData: () => ({ id: "workspace-2" }),
      }),
    ).rejects.toMatchObject({ failure: { code: "FORBIDDEN" } });

    expect(events).toEqual([
      expect.objectContaining({
        action: "workspace.provisioned",
        outcome: "denied",
        commandId: command.commandId,
      }),
    ]);
  });

  it("compensates a provisional identity, and makes a double failure reconcilable", async () => {
    const claimFailure = contractError("INVITATION_USED");
    const compensationFailure = contractError("DEPENDENCY_UNAVAILABLE");
    const compensate = vi.fn(async () => {
      throw compensationFailure;
    });
    const { flows } = harness({
      identity: identityPort({ compensateProvisionalPrincipal: compensate }),
      administration: administrationPort({
        claimInvitationForPrincipal: vi.fn(async () => {
          throw claimFailure;
        }),
      }),
    });

    await expect(
      flows.acceptInviteWithPasswordSignup({
        token: "concurrently-consumed-token",
        email: "person@example.com",
        displayName: "Person",
        password: "not-stored-password",
        command,
      }),
    ).rejects.toMatchObject({
      failure: { code: "COMPENSATION_FAILED", commandId: command.commandId },
      cause: expect.any(AggregateError),
    });
    expect(compensate).toHaveBeenCalledOnce();
    await expect(flows.reconcileCommand({ command, operation: "invite-password-signup" })).resolves.toMatchObject({
      status: "reconciliation-required",
    });
  });

  it("does not compensate an identity after the invitation claim committed but parent completion failed", async () => {
    const compensate = vi.fn(async () => {});
    const { flows } = harness({
      identity: identityPort({ compensateProvisionalPrincipal: compensate }),
    });
    db!.exec(`
      CREATE TRIGGER fail_parent_invite_completion
      BEFORE UPDATE OF status ON account_commands
      WHEN OLD.operation = 'invite-password-signup' AND NEW.status = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'simulated parent completion failure');
      END;
    `);

    await expect(
      flows.acceptInviteWithPasswordSignup({
        token: "committed-token",
        email: "person@example.com",
        displayName: "Person",
        password: "a-valid-length-password",
        command,
      }),
    ).rejects.toMatchObject({ failure: { code: "DEPENDENCY_UNAVAILABLE" } });
    expect(compensate).not.toHaveBeenCalled();
    await expect(flows.reconcileCommand({ command, operation: "invite-password-signup" })).resolves.toMatchObject({
      status: "reconciliation-required",
      repair: {
        kind: "invitation-claim-committed",
        targetPrincipalId: "principal-1",
      },
    });
  });

  it("replays a completed semantic result, rejects mismatched payloads, and stores no bearer input", async () => {
    const claim = vi.fn(async () => member);
    const prepare = vi.fn(async () => ({
      emailVerifiedByInvitation: true,
      workspaceId: "workspace-1",
    }));
    const create = vi.fn(async () => ({
      principalId: "principal-1",
      compensationHandle: "opaque-handle",
    }));
    const { flows } = harness({
      identity: identityPort({ createProvisionalCredentialPrincipal: create }),
      administration: administrationPort({
        preparePasswordInvitationClaim: prepare,
        claimInvitationForPrincipal: claim,
      }),
    });
    const input = {
      token: "write-once-invitation-secret",
      email: "person@example.com",
      displayName: "Person",
      password: "write-once-password-secret",
      command,
    };

    const first = await flows.acceptInviteWithPasswordSignup(input);
    await expect(flows.acceptInviteWithPasswordSignup(input)).resolves.toEqual(first);
    expect(create).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    await expect(
      flows.acceptInviteWithPasswordSignup({
        ...input,
        email: "different@example.com",
      }),
    ).rejects.toMatchObject({ failure: { code: "IDEMPOTENCY_CONFLICT" } });
    await expect(
      flows.acceptInviteWithPasswordSignup({
        ...input,
        password: "a-different-write-once-password",
      }),
    ).rejects.toMatchObject({ failure: { code: "IDEMPOTENCY_CONFLICT" } });

    const stored = db!
      .prepare(
        `
      SELECT payloadHash, resultJson, workspaceId, targetPrincipalId
        FROM account_commands
       WHERE operation = 'invite-password-signup'
    `,
      )
      .get() as {
      payloadHash: string;
      resultJson: string;
      workspaceId: string;
      targetPrincipalId: string;
    };
    expect(stored.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.resultJson).not.toContain(input.token);
    expect(stored.resultJson).not.toContain(input.password);
    expect(stored.workspaceId).toBe("workspace-1");
    expect(stored.targetPrincipalId).toBe("principal-1");
  });

  it("leaves invitation audit ownership with AccountAdminPort rather than duplicating it", async () => {
    const { flows, events } = harness();
    const input = {
      token: "audit-must-not-contain-this-invite-token",
      email: "person@example.com",
      displayName: "Person",
      password: "audit-must-not-contain-this-password",
      command,
    };

    await flows.acceptInviteWithPasswordSignup(input);
    await flows.acceptInviteWithPasswordSignup(input);

    expect(events).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain(input.token);
    expect(JSON.stringify(events)).not.toContain(input.password);
  });

  it.each([
    ["compensates after the claim fails", false],
    ["retains exact repair state when compensation also fails", true],
  ] as const)("keeps an in-flight signup command durable across erasure and %s", async (_case, failCompensation) => {
    let identityEntered!: () => void;
    let releaseIdentity!: () => void;
    const entered = new Promise<void>((resolve) => {
      identityEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseIdentity = resolve;
    });
    const claimFailure = contractError("NOT_FOUND");
    const compensationFailure = contractError("DEPENDENCY_UNAVAILABLE");
    const compensate = vi.fn(async () => {
      if (failCompensation) throw compensationFailure;
    });
    const create = vi.fn<LocalIdentityPort["createCorrelatedProvisionalCredentialPrincipal"]>(
      async ({ correlatePrincipalInTransaction }) => {
        identityEntered();
        await release;
        correlatePrincipalInTransaction("principal-1");
        return {
          principalId: "principal-1",
          compensationHandle: "opaque-handle",
        };
      },
    );
    const { flows } = harness({
      identity: identityPort({
        createCorrelatedProvisionalCredentialPrincipal: create,
        compensateProvisionalPrincipal: compensate,
      }),
      administration: administrationPort({
        workspacePrincipalIds: vi.fn(() => []),
        claimInvitationForPrincipal: vi.fn(async () => {
          throw claimFailure;
        }),
      }),
    });
    const signup = flows.acceptInviteWithPasswordSignup({
      token: "invite-erased-during-signup",
      email: "person@example.com",
      displayName: "Person",
      password: "not-stored-password",
      command,
    });

    await entered;
    expect(
      db!
        .prepare(
          `
      SELECT status, workspaceId
        FROM account_commands
       WHERE commandId = ?
    `,
        )
        .get(command.commandId),
    ).toEqual({ status: "pending", workspaceId: "workspace-1" });

    await expect(
      flows.eraseWorkspace({
        actor,
        workspaceId: "workspace-1",
        command: {
          commandId: "workspace-erasure-command",
          idempotencyKey: "workspace-erasure-idempotency",
        },
      }),
    ).resolves.toMatchObject({ commandId: "workspace-erasure-command" });
    const commandAfterErasure = db!
      .prepare(
        `
      SELECT status, workspaceId
        FROM account_commands
       WHERE commandId = ?
    `,
      )
      .get(command.commandId);

    releaseIdentity();
    const signupFailure = await signup.then(
      () => null,
      (error: unknown) => error,
    );

    expect(commandAfterErasure).toEqual({
      status: "pending",
      workspaceId: "workspace-1",
    });
    expect(compensate).toHaveBeenCalledOnce();
    if (failCompensation) {
      expect(signupFailure).toMatchObject({
        failure: { code: "COMPENSATION_FAILED" },
        cause: expect.any(AggregateError),
      });
      await expect(
        flows.reconcileCommand({
          command,
          operation: "invite-password-signup",
        }),
      ).resolves.toMatchObject({
        status: "reconciliation-required",
        repair: {
          kind: "provisional-principal-compensation-failed",
          targetPrincipalId: "principal-1",
          provisionalPrincipalId: "principal-1",
        },
      });
    } else {
      expect(signupFailure).toBe(claimFailure);
      await expect(
        flows.reconcileCommand({
          command,
          operation: "invite-password-signup",
        }),
      ).resolves.toMatchObject({ status: "compensated" });
    }
  });

  it("deprovisions an erased workspace principal set through one bulk identity call", async () => {
    const deprovisionMany = vi.fn<LocalIdentityPort["deprovisionLocalPrincipalsInTx"]>();
    const deprovisionOne = vi.fn<LocalIdentityPort["deprovisionLocalPrincipalInTx"]>();
    const principalIds = ["principal-1", "principal-2", "principal-3"];
    const { flows } = harness({
      identity: identityPort({
        deprovisionLocalPrincipalInTx: deprovisionOne,
        deprovisionLocalPrincipalsInTx: deprovisionMany,
      }),
      administration: administrationPort({
        workspacePrincipalIds: vi.fn(() => principalIds),
        eraseWorkspaceAdministrationInTx: vi.fn(() => principalIds),
      }),
    });
    const erasureCommand = {
      commandId: "bulk-erasure-command",
      idempotencyKey: "bulk-erasure-idempotency",
    };

    await expect(
      flows.eraseWorkspace({
        actor,
        workspaceId: "workspace-1",
        command: erasureCommand,
      }),
    ).resolves.toMatchObject({ commandId: erasureCommand.commandId });

    expect(deprovisionMany).toHaveBeenCalledOnce();
    expect(deprovisionMany).toHaveBeenCalledWith(principalIds, erasureCommand.commandId);
    expect(deprovisionOne).not.toHaveBeenCalled();
  });

  it("bounds workspace-erasure membership re-snapshot attempts before reserving the command", async () => {
    const membershipSnapshots = [
      [],
      ["principal-1"],
      ["principal-1", "principal-2"],
      ["principal-1", "principal-2", "principal-3"],
    ];
    let snapshotIndex = 0;
    const workspacePrincipalIds = vi.fn(
      () => membershipSnapshots[Math.min(snapshotIndex++, membershipSnapshots.length - 1)]!,
    );
    const eraseWorkspaceAdministrationInTx = vi.fn(() => [] as string[]);
    const { flows } = harness({
      administration: administrationPort({
        workspacePrincipalIds,
        eraseWorkspaceAdministrationInTx,
      }),
    });
    const erasureCommand = {
      commandId: "bounded-erasure-command",
      idempotencyKey: "bounded-erasure-idempotency",
    };

    await expect(
      flows.eraseWorkspace({
        actor,
        workspaceId: "workspace-1",
        command: erasureCommand,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "CONFLICT",
        retryable: true,
        commandId: erasureCommand.commandId,
      },
    });

    expect(workspacePrincipalIds).toHaveBeenCalledTimes(4);
    expect(eraseWorkspaceAdministrationInTx).not.toHaveBeenCalled();
    expect(
      db!.prepare(`SELECT status FROM account_commands WHERE commandId = ?`).get(erasureCommand.commandId),
    ).toBeUndefined();
  });

  it("burns a reset ceremony when authority changes after minting", async () => {
    const ceremony: PasswordResetCeremony = {
      ceremonyId: "ceremony-1",
      token: "write-once-reset-token",
      expiresAt: "2026-01-02T00:00:00.000Z",
    };
    const revoke = vi.fn(async () => {});
    const { flows } = harness({
      identity: identityPort({
        issuePasswordReset: vi.fn(async () => ceremony),
        revokePasswordResetCeremony: revoke,
      }),
      administration: administrationPort({
        confirmIdentityAdminAuthority: vi.fn(async () => false),
      }),
    });

    await expect(
      flows.issuePasswordReset({
        actor,
        targetPrincipalId: "principal-1",
        command,
      }),
    ).rejects.toMatchObject({ failure: { code: "AUTHORITY_CHANGED" } });
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        targetPrincipalId: "principal-1",
        ceremonyId: ceremony.ceremonyId,
      }),
    );
    await expect(flows.reconcileCommand({ command, operation: "password-reset" })).resolves.toMatchObject({
      status: "compensated",
    });
  });

  it("rechecks current authority before replaying a write-once password-reset token", async () => {
    const evaluate = vi
      .fn<LocalAccountAdminPort["evaluateIdentityAdminAuthority"]>()
      .mockResolvedValueOnce({
        allowed: true,
        revision: "revision-1",
        policyVersion: "account-policy-v1",
      })
      .mockResolvedValueOnce({
        allowed: false,
        reason: "insufficient-authority",
      });
    const { flows } = harness({
      administration: administrationPort({
        evaluateIdentityAdminAuthority: evaluate,
      }),
    });

    await expect(
      flows.issuePasswordReset({
        actor,
        targetPrincipalId: "principal-1",
        command,
      }),
    ).resolves.toMatchObject({ token: "write-once-reset-token" });
    await expect(
      flows.issuePasswordReset({
        actor,
        targetPrincipalId: "principal-1",
        command,
      }),
    ).rejects.toMatchObject({ failure: { code: "FORBIDDEN" } });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("drops the plaintext password-reset replay after the short response-loss horizon", async () => {
    vi.useFakeTimers();
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    vi.setSystemTime(startedAt);
    const { flows } = harness();
    const input = { actor, targetPrincipalId: "principal-1", command };

    const issued = await flows.issuePasswordReset(input);
    vi.setSystemTime(startedAt.getTime() + WRITE_ONCE_SECRET_REPLAY_WINDOW_MS - 1);
    await expect(flows.issuePasswordReset(input)).resolves.toEqual(issued);

    vi.setSystemTime(startedAt.getTime() + WRITE_ONCE_SECRET_REPLAY_WINDOW_MS);
    await expect(flows.issuePasswordReset(input)).rejects.toMatchObject({
      failure: { code: "CONFLICT" },
    });
  });

  it("refuses reset issuance under replay pressure without displacing a completed response", async () => {
    const identity = identityPort();
    const { flows } = harness({ identity, writeOnceReplayCapacity: 1 });
    const firstInput = { actor, targetPrincipalId: "principal-1", command };
    const secondCommand = {
      commandId: "command-2",
      idempotencyKey: "idempotency-2",
    };

    const first = await flows.issuePasswordReset(firstInput);
    await expect(
      flows.issuePasswordReset({
        actor,
        targetPrincipalId: "principal-2",
        command: secondCommand,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: WRITE_ONCE_SECRET_REPLAY_WINDOW_MS / 1_000,
      },
    });

    await expect(flows.issuePasswordReset(firstInput)).resolves.toEqual(first);
    expect(identity.issuePasswordReset).toHaveBeenCalledTimes(1);
    await expect(
      flows.reconcileCommand({
        command: secondCommand,
        operation: "password-reset",
      }),
    ).resolves.toMatchObject({ status: "compensated" });
  });

  it("does not age a stale-looking reset command while its executor can still mint the ceremony", async () => {
    let entered!: () => void;
    let release!: () => void;
    const sideEffectEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const sideEffectRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ceremonyVisible = false;
    const { flows, lock } = harness({
      identity: identityPort({
        issuePasswordReset: vi.fn(async () => {
          entered();
          await sideEffectRelease;
          ceremonyVisible = true;
          return {
            ceremonyId: "ceremony-live",
            token: "write-once-reset-token",
            expiresAt: "2026-01-02T00:00:00.000Z",
          };
        }),
      }),
    });

    const execution = flows.issuePasswordReset({
      actor,
      targetPrincipalId: "principal-1",
      command,
    });
    await sideEffectEntered;
    db!
      .prepare(`UPDATE account_commands SET updatedAt = ? WHERE commandId = ?`)
      .run("2000-01-01T00:00:00.000Z", command.commandId);
    const reconciliation = flows.reconcileCommand({
      command,
      operation: "password-reset",
    });

    expect(ceremonyVisible).toBe(false);
    expect(db!.prepare(`SELECT status FROM account_commands WHERE commandId = ?`).get(command.commandId)).toEqual({
      status: "pending",
    });
    release();
    await expect(execution).resolves.toMatchObject({
      ceremonyId: "ceremony-live",
    });
    await expect(reconciliation).resolves.toMatchObject({
      status: "completed",
    });
    expect(lock.pendingKeyCount()).toBe(0);
  });

  it("does not age a stale-looking session command while its executor can still revoke sessions", async () => {
    let entered!: () => void;
    let release!: () => void;
    const sideEffectEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const sideEffectRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    let revocationVisible = false;
    const { flows, lock } = harness({
      identity: identityPort({
        revokePrincipalSessions: vi.fn(async ({ command: value }) => {
          entered();
          await sideEffectRelease;
          revocationVisible = true;
          return {
            commandId: value.commandId,
            completedAt: "2026-01-01T00:00:00.000Z",
          };
        }),
      }),
    });

    const execution = flows.revokeMemberSessions({
      actor,
      targetPrincipalId: "principal-1",
      command,
    });
    await sideEffectEntered;
    db!
      .prepare(`UPDATE account_commands SET updatedAt = ? WHERE commandId = ?`)
      .run("2000-01-01T00:00:00.000Z", command.commandId);
    const reconciliation = flows.reconcileCommand({
      command,
      operation: "session-revocation",
    });

    expect(revocationVisible).toBe(false);
    expect(db!.prepare(`SELECT status FROM account_commands WHERE commandId = ?`).get(command.commandId)).toEqual({
      status: "pending",
    });
    release();
    await expect(execution).resolves.toMatchObject({
      commandId: command.commandId,
    });
    await expect(reconciliation).resolves.toMatchObject({
      status: "completed",
    });
    expect(lock.pendingKeyCount()).toBe(0);
  });

  it("still ages a stale pending command when no executor owns its command lock", async () => {
    const { flows } = harness();
    reserveAccountCommand(db!, {
      applicationId: "conformance-application",
      operation: "password-reset:actor:actor-1",
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      actorPrincipalId: actor.principalId,
      targetPrincipalId: "principal-1",
      payloadHash: "a".repeat(64),
      now: "2000-01-01T00:00:00.000Z",
    });

    await expect(flows.reconcileCommand({ command, operation: "password-reset" })).resolves.toMatchObject({
      status: "reconciliation-required",
      receipt: { commandId: command.commandId, observedAt: expect.any(String) },
      failure: { commandId: command.commandId },
      repair: { kind: "stale-pending", targetPrincipalId: "principal-1" },
    });
  });

  it("reports a live pending command observation without claiming it completed", async () => {
    const { flows } = harness();
    const observedAt = new Date().toISOString();
    reserveAccountCommand(db!, {
      applicationId: "conformance-application",
      operation: "password-reset:actor:actor-1",
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      actorPrincipalId: actor.principalId,
      targetPrincipalId: "principal-1",
      payloadHash: "a".repeat(64),
      now: observedAt,
    });

    await expect(flows.reconcileCommand({ command, operation: "password-reset" })).resolves.toEqual({
      status: "pending",
      receipt: { commandId: command.commandId, observedAt },
    });
  });

  const corruptRepairMetadata: ReadonlyArray<readonly [string, AccountFlowOperation, string]> = [
    ["malformed JSON", "password-reset", '{"kind":"password-reset-issued"'],
    ["non-object JSON", "password-reset", "[]"],
    ["missing repair kind", "password-reset", "{}"],
    ["unknown repair kind", "password-reset", JSON.stringify({ kind: "password-reset-otucome-unknown" })],
    [
      "missing invitation provisional principal",
      "invite-password-signup",
      JSON.stringify({
        kind: "invitation-claim-committed",
        workspaceId: "workspace-1",
        targetPrincipalId: "principal-1",
        provisionalPrincipalId: null,
        ceremonyId: null,
      }),
    ],
    [
      "missing compensation provisional principal",
      "invite-password-signup",
      JSON.stringify({
        kind: "provisional-principal-compensation-failed",
        workspaceId: null,
        targetPrincipalId: "principal-1",
        provisionalPrincipalId: null,
        ceremonyId: null,
      }),
    ],
    [
      "missing issued reset ceremony",
      "password-reset",
      JSON.stringify({
        kind: "password-reset-issued",
        workspaceId: null,
        targetPrincipalId: "principal-1",
        provisionalPrincipalId: null,
        ceremonyId: null,
      }),
    ],
    [
      "missing failed reset-revocation ceremony",
      "password-reset",
      JSON.stringify({
        kind: "password-reset-revocation-failed",
        workspaceId: null,
        targetPrincipalId: "principal-1",
        provisionalPrincipalId: null,
      }),
    ],
  ];

  it.each(corruptRepairMetadata)(
    "fails closed without changing corrupt reconciliation metadata: %s",
    async (_case, operation, resultJson) => {
      const { flows } = harness();
      const ledgerOperation =
        operation === "invite-password-signup" ? operation : `${operation}:actor:${actor.principalId}`;
      reserveAccountCommand(db!, {
        applicationId: "conformance-application",
        operation: ledgerOperation,
        idempotencyKey: command.idempotencyKey,
        commandId: command.commandId,
        actorPrincipalId: actor.principalId,
        targetPrincipalId: "principal-1",
        payloadHash: "a".repeat(64),
      });
      finishAccountCommand(db!, {
        applicationId: "conformance-application",
        operation: ledgerOperation,
        idempotencyKey: command.idempotencyKey,
        status: "reconciliation_required",
        failureCode: "DEPENDENCY_UNAVAILABLE",
        resultJson: JSON.stringify({ kind: "operator-review" }),
      });
      // Simulate storage corruption or an unsafe operational edit. The normal table CHECK rejects
      // invalid JSON, but reconciliation must still fail closed if the durable bytes are damaged.
      db!.exec("PRAGMA ignore_check_constraints = ON");
      db!.prepare(`UPDATE account_commands SET resultJson = ? WHERE commandId = ?`).run(resultJson, command.commandId);
      db!.exec("PRAGMA ignore_check_constraints = OFF");
      const stored = db!
        .prepare(`SELECT status, resultJson FROM account_commands WHERE commandId = ?`)
        .get(command.commandId);

      await expect(flows.reconcileCommand({ command, operation })).rejects.toMatchObject({
        name: "CorruptAccountCommandStateError",
        code: "ACCOUNT_COMMAND_STATE_CORRUPT",
        commandId: command.commandId,
      });
      expect(
        db!.prepare(`SELECT status, resultJson FROM account_commands WHERE commandId = ?`).get(command.commandId),
      ).toEqual(stored);
    },
  );

  it("retains the explicit legacy fallback only for null reconciliation metadata", async () => {
    const { flows } = harness();
    reserveAccountCommand(db!, {
      applicationId: "conformance-application",
      operation: "password-reset:actor:actor-1",
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      actorPrincipalId: actor.principalId,
      targetPrincipalId: "principal-1",
      payloadHash: "a".repeat(64),
    });
    finishAccountCommand(db!, {
      applicationId: "conformance-application",
      operation: "password-reset:actor:actor-1",
      idempotencyKey: command.idempotencyKey,
      status: "reconciliation_required",
      failureCode: "DEPENDENCY_UNAVAILABLE",
      resultJson: null,
    });

    await expect(flows.reconcileCommand({ command, operation: "password-reset" })).resolves.toMatchObject({
      status: "reconciliation-required",
      repair: {
        kind: "operator-review",
        targetPrincipalId: "principal-1",
        provisionalPrincipalId: null,
        ceremonyId: null,
      },
    });
  });

  it("does not age stale pending state until command id, idempotency key and operation all match", async () => {
    const { flows } = harness();
    reserveAccountCommand(db!, {
      applicationId: "conformance-application",
      operation: "password-reset:actor:actor-1",
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      actorPrincipalId: actor.principalId,
      targetPrincipalId: "principal-1",
      payloadHash: "a".repeat(64),
      now: "2000-01-01T00:00:00.000Z",
    });
    const original = db!
      .prepare(
        `
      SELECT status, updatedAt FROM account_commands WHERE commandId = ?
    `,
      )
      .get(command.commandId);

    await expect(
      flows.reconcileCommand({
        command: { ...command, idempotencyKey: "incorrect-idempotency-key" },
        operation: "password-reset",
      }),
    ).resolves.toBeNull();
    await expect(
      flows.reconcileCommand({
        command,
        operation: "session-revocation",
      }),
    ).resolves.toBeNull();
    expect(
      db!
        .prepare(
          `
      SELECT status, updatedAt FROM account_commands WHERE commandId = ?
    `,
        )
        .get(command.commandId),
    ).toEqual(original);

    await expect(flows.reconcileCommand({ command, operation: "password-reset" })).resolves.toMatchObject({
      status: "reconciliation-required",
    });
  });

  it("marks reset revocation failure as reconciliation-required", async () => {
    const { flows, events } = harness({
      identity: identityPort({
        revokePasswordResetCeremony: vi.fn(async () => {
          throw contractError("DEPENDENCY_UNAVAILABLE");
        }),
      }),
      administration: administrationPort({
        confirmIdentityAdminAuthority: vi.fn(async () => false),
      }),
    });

    await expect(
      flows.issuePasswordReset({
        actor,
        targetPrincipalId: "principal-1",
        command,
      }),
    ).rejects.toMatchObject({ failure: { code: "COMPENSATION_FAILED" } });
    await expect(flows.reconcileCommand({ command, operation: "password-reset" })).resolves.toMatchObject({
      status: "reconciliation-required",
    });
    expect(events.filter((event) => event.action === "flow.reconciliation_required")).toHaveLength(1);
  });

  it("records and audits a known no-identity reset refusal as compensated rather than outcome-unknown", async () => {
    const missing = contractError("NOT_FOUND");
    const { flows, events } = harness({
      identity: identityPort({
        issuePasswordReset: vi.fn(async () => {
          throw missing;
        }),
      }),
    });

    await expect(
      flows.issuePasswordReset({
        actor,
        targetPrincipalId: "principal-1",
        command,
      }),
    ).rejects.toBe(missing);
    await expect(flows.reconcileCommand({ command, operation: "password-reset" })).resolves.toMatchObject({
      status: "compensated",
    });
    expect(events).toEqual([
      expect.objectContaining({
        action: "flow.compensated",
        outcome: "compensated",
        commandId: command.commandId,
      }),
    ]);
  });

  it("audits a session-revocation authority dependency failure exactly once", async () => {
    const unavailable = contractError("DEPENDENCY_UNAVAILABLE");
    const { flows, events } = harness({
      administration: administrationPort({
        evaluateIdentityAdminAuthority: vi.fn(async () => {
          throw unavailable;
        }),
      }),
    });

    await expect(
      flows.revokeMemberSessions({
        actor,
        targetPrincipalId: "principal-1",
        command,
      }),
    ).rejects.toBe(unavailable);

    expect(events).toEqual([
      expect.objectContaining({
        action: "identity.sessions_revoked",
        outcome: "failed",
        commandId: command.commandId,
      }),
    ]);
  });

  it("records unknown reset and session-revocation outcomes for operator reconciliation", async () => {
    const resetCommand = {
      commandId: "reset-command",
      idempotencyKey: "reset-idempotency",
    };
    const revokeCommand = {
      commandId: "revoke-command",
      idempotencyKey: "revoke-idempotency",
    };
    const dependency = contractError("DEPENDENCY_UNAVAILABLE");
    const { flows } = harness({
      identity: identityPort({
        issuePasswordReset: vi.fn(async () => {
          throw dependency;
        }),
        revokePrincipalSessions: vi.fn(async () => {
          throw dependency;
        }),
      }),
    });

    await expect(
      flows.issuePasswordReset({
        actor,
        targetPrincipalId: "principal-1",
        command: resetCommand,
      }),
    ).rejects.toBe(dependency);
    await expect(
      flows.revokeMemberSessions({
        actor,
        targetPrincipalId: "principal-1",
        command: revokeCommand,
      }),
    ).rejects.toBe(dependency);
    await expect(
      flows.reconcileCommand({
        command: resetCommand,
        operation: "password-reset",
      }),
    ).resolves.toMatchObject({
      status: "reconciliation-required",
      repair: { kind: "password-reset-outcome-unknown" },
    });
    await expect(
      flows.reconcileCommand({
        command: revokeCommand,
        operation: "session-revocation",
      }),
    ).resolves.toMatchObject({
      status: "reconciliation-required",
      repair: { kind: "session-revocation-outcome-unknown" },
    });
  });

  it("serializes membership mutation ahead of irreversible session revocation", async () => {
    const lock = new KeyedOperationLock();
    let allowed = true;
    let releaseMutation!: () => void;
    let mutationEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      mutationEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const mutation = lock.withKeys(["principal-1"], async () => {
      mutationEntered();
      await release;
      allowed = false;
    });
    await entered;
    const revoke = vi.fn(async () => ({
      commandId: command.commandId,
      completedAt: "2026-01-01T00:00:00.000Z",
    }));
    const { flows } = harness({
      lock,
      identity: identityPort({ revokePrincipalSessions: revoke }),
      administration: administrationPort({
        evaluateIdentityAdminAuthority: vi.fn(async (): Promise<IdentityAdminAuthorityDecision> =>
          allowed
            ? {
                allowed: true,
                revision: "revision-1",
                policyVersion: "account-policy-v1",
              }
            : { allowed: false, reason: "insufficient-authority" },
        ),
      }),
    });
    const revocation = flows.revokeMemberSessions({
      actor,
      targetPrincipalId: "principal-1",
      command,
    });
    releaseMutation();
    await mutation;

    await expect(revocation).rejects.toMatchObject({
      failure: { code: "FORBIDDEN" },
    });
    expect(revoke).not.toHaveBeenCalled();
  });

  it("rejects a nested lock-set expansion that violates global acquisition order", async () => {
    const lock = new KeyedOperationLock();

    await expect(
      lock.withKeys(["principal-b"], () => lock.withKeys(["principal-a", "principal-b"], () => undefined)),
    ).rejects.toThrow(/lock order violation/i);
    expect(lock.pendingKeyCount()).toBe(0);
  });

  it("does not treat async context retained after release as a still-held lock", async () => {
    const lock = new KeyedOperationLock();
    let triggerLate!: () => void;
    const trigger = new Promise<void>((resolve) => {
      triggerLate = resolve;
    });
    let late!: Promise<void>;
    let lateEntered = false;

    await lock.withKeys(["principal-1"], () => {
      late = trigger.then(() =>
        lock.withKeys(["principal-1"], () => {
          lateEntered = true;
        }),
      );
    });

    let releaseBlocker!: () => void;
    const blocker = lock.withKeys(
      ["principal-1"],
      () =>
        new Promise<void>((resolve) => {
          releaseBlocker = resolve;
        }),
    );
    await Promise.resolve();
    triggerLate();
    await Promise.resolve();
    expect(lateEntered).toBe(false);
    releaseBlocker();
    await blocker;
    await late;
    expect(lateEntered).toBe(true);
  });

  it("locks every workspace principal before erasure can race identity administration", async () => {
    const lock = new KeyedOperationLock();
    let releasePrincipal!: () => void;
    let principalLocked!: () => void;
    const entered = new Promise<void>((resolve) => {
      principalLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releasePrincipal = resolve;
    });
    const mutation = lock.withKeys(["principal-1"], async () => {
      principalLocked();
      await release;
    });
    await entered;
    const assertAuthority = vi.fn();
    const { flows } = harness({
      lock,
      administration: administrationPort({
        workspacePrincipalIds: vi.fn(() => ["principal-1"]),
        assertWorkspaceErasureAuthorityInTx: assertAuthority,
      }),
    });

    const erasure = flows.eraseWorkspace({
      actor,
      workspaceId: "workspace-1",
      command: {
        commandId: "erasure-command",
        idempotencyKey: "erasure-idempotency",
      },
    });
    await Promise.resolve();
    expect(assertAuthority).not.toHaveBeenCalled();

    releasePrincipal();
    await mutation;
    await expect(erasure).resolves.toMatchObject({
      commandId: "erasure-command",
    });
    expect(assertAuthority).toHaveBeenCalledOnce();
  });

  it("locks every workspace principal around legacy transactional batch erasure", async () => {
    const lock = new KeyedOperationLock();
    let releasePrincipal!: () => void;
    let principalLocked!: () => void;
    const entered = new Promise<void>((resolve) => {
      principalLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releasePrincipal = resolve;
    });
    const mutation = lock.withKeys(["principal-1"], async () => {
      principalLocked();
      await release;
    });
    await entered;
    const erase = vi.fn();
    const { flows } = harness({
      lock,
      administration: administrationPort({
        workspacePrincipalIds: vi.fn(() => ["principal-1"]),
      }),
    });

    const erasure = flows.withWorkspaceErasureLocks(["workspace-1"], erase);
    await Promise.resolve();
    expect(erase).not.toHaveBeenCalled();
    releasePrincipal();
    await mutation;
    await erasure;
    expect(erase).toHaveBeenCalledOnce();
  });

  it("keeps a missing principal summary explicit and propagates identity dependency failure", async () => {
    const dependency = contractError("DEPENDENCY_UNAVAILABLE");
    const { flows } = harness({
      identity: identityPort({
        getPrincipalSummaries: vi.fn(async () => []),
        verifyApplicationSession: vi.fn(async () => {
          throw dependency;
        }),
      }),
    });

    await expect(flows.listMemberDirectory({ actor, workspaceId: "workspace-1" })).resolves.toEqual([
      { membership: member, principal: null },
    ]);
    await expect(
      flows.resolveRequestAccess({
        headers: new Headers(),
        workspaceId: "workspace-1",
      }),
    ).rejects.toBe(dependency);
  });
});
