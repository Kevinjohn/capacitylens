import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@capacitylens/shared/account/types";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { KeyedOperationLock } from "../accounts/KeyedOperationLock";
import type { Db } from "../db";
import type { TenantStore } from "../tenantStore";
import { registerImportRoutes, type ImportRouteDependencies } from "./importRoutes";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createRaceHarness(nextRole: Role | null) {
  const app = Fastify();
  apps.push(app);
  app.addHook("preHandler", (request, _reply, done) => {
    request.user = {
      id: "principal-1",
      name: "Bruce Wayne",
      email: "bruce@wayne.test",
      emailVerified: true,
      image: null,
    };
    done();
  });
  let currentRole: Role | null = "owner";
  const workerStarted = deferred();
  const releaseWorker = deferred();
  const accountLock = new KeyedOperationLock();
  const currentSlice = emptyAppData() as AppData;
  currentSlice.accounts.push({
    id: "a1",
    name: "Wayne Enterprises",
    color: "#3b82f6",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const commitProductAudit = vi.fn((_reply, _record, mutation: () => void) => {
    mutation();
    return true;
  });
  const dependencies: ImportRouteDependencies = {
    db: {} as Db,
    store: { readFullSlice: () => currentSlice } as unknown as TenantStore,
    authMode: "password",
    allowReset: false,
    accountAdminPort: {
      roleForPrincipalInWorkspace: () => currentRole,
    } as unknown as ImportRouteDependencies["accountAdminPort"],
    accountLock,
    authorize: () => true,
    executeImportWorker: vi.fn(async () => {
      workerStarted.resolve();
      await releaseWorker.promise;
      return { imported: 1, skipped: 0, data: currentSlice };
    }),
    commitProductAudit,
    fail: (reply, error) => reply.code(500).send({ error: error instanceof Error ? error.message : "failed" }),
  };
  registerImportRoutes(app, dependencies);
  return {
    app,
    accountLock,
    commitProductAudit,
    workerStarted,
    releaseWorker,
    currentSlice,
    applyRole: () => {
      currentRole = nextRole;
    },
  };
}

describe("import authority races", () => {
  it.each([
    ["demoted", "editor"],
    ["removed", null],
    ["loses the account", null],
  ] as const)("refuses an import when its owner is %s while worker preparation is paused", async (_case, nextRole) => {
    const { app, accountLock, commitProductAudit, workerStarted, releaseWorker, currentSlice, applyRole } =
      createRaceHarness(nextRole);
    const lockHeld = deferred();
    const applyMembershipChange = deferred();

    const importing = app.inject({
      method: "POST",
      url: "/api/import",
      payload: { accountId: "a1", data: currentSlice },
    });
    await workerStarted.promise;
    const membershipChange = accountLock.withKeys(["principal-1", "workspace:a1"], async () => {
      lockHeld.resolve();
      await applyMembershipChange.promise;
      applyRole();
    });
    await lockHeld.promise;

    releaseWorker.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    applyMembershipChange.resolve();
    await membershipChange;

    const response = await importing;
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Only the account owner can import data." });
    expect(commitProductAudit).not.toHaveBeenCalled();
  });
});
