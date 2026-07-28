import { beforeAll, describe, expect, it, vi } from "vitest";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { buildApp } from "./app";
import { getRow, insertRow, openDb } from "./db";
import { emptyAppData, type AppData, type Discipline } from "@capacitylens/shared/types/entities";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";

interface SyncAdapter {
  loadAll(accountId?: string): Promise<AppData>;
  saveAll(data: AppData, options?: { unload?: boolean }): Promise<void>;
}

interface SyncAdapterConstructor {
  new (baseUrl: string, fetchImpl: typeof fetch): SyncAdapter;
}

let ServerSyncAdapter: SyncAdapterConstructor;

beforeAll(async () => {
  // Keep this integration spec in the server project without making the server TypeScript build
  // compile the browser adapter and its DOM-only offline-cache dependencies.
  const adapterUrl = new URL("../../src/data/ServerSyncAdapter.ts", import.meta.url).href;
  const adapterModule = (await import(/* @vite-ignore */ adapterUrl)) as {
    ServerSyncAdapter: SyncAdapterConstructor;
  };
  ServerSyncAdapter = adapterModule.ServerSyncAdapter;
});

const TS1 = "2026-01-01T00:00:00.000Z";
const TS2 = "2026-01-02T00:00:00.000Z";
const TS3 = "2026-01-03T00:00:00.000Z";

const account = {
  id: "a1",
  name: "Studio",
  color: "#5c34d4",
  createdAt: TS1,
  updatedAt: TS1,
};
const discipline = (name: string, updatedAt: string): Discipline => ({
  id: "d1",
  accountId: "a1",
  name,
  color: "#5c34d4",
  sortOrder: 0,
  createdAt: TS1,
  updatedAt,
});
const withDiscipline = (row?: Discipline): AppData => ({
  ...emptyAppData(),
  accounts: [account],
  clients: [buildInternalClient(account.id, TS1)],
  disciplines: row ? [row] : [],
});

const responseFromInject = (result: LightMyRequestResponse): Response =>
  new Response(result.body, {
    status: result.statusCode,
    headers: Object.fromEntries(
      Object.entries(result.headers).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : String(value)]],
      ),
    ),
  });

type ArrivalOrder = "ordinary-first" | "teardown-first";

function integrationHarness(arrivalOrder: ArrivalOrder, initial?: Discipline) {
  const db = openDb(":memory:");
  insertRow(db, "accounts", account);
  // Production account provisioning creates this anchor in the same transaction. This harness
  // inserts rows directly, so include it explicitly rather than exercising hydration repair as the
  // first intercepted batch in tests whose subject is ordinary-vs-teardown request ordering.
  insertRow(db, "clients", buildInternalClient(account.id, TS1) as unknown as Record<string, unknown>);
  if (initial) insertRow(db, "disciplines", initial as unknown as Record<string, unknown>);
  const app = buildApp(db, { optimisticConcurrency: false });
  let firstBatch = true;
  let releaseFirst: (() => void) | undefined;

  const inject = async (url: string, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    const result = await app.inject({
      method: (init?.method ?? "GET") as InjectOptions["method"],
      url: `${parsed.pathname}${parsed.search}`,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      payload: init?.body as InjectOptions["payload"],
    });
    return responseFromInject(result);
  };
  const fetchImpl = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.endsWith("/api/batch") || !firstBatch) return inject(url, init);
    firstBatch = false;
    if (arrivalOrder === "ordinary-first") {
      return inject(url, init).then(
        (response) =>
          new Promise<Response>((resolve) => {
            releaseFirst = () => resolve(response);
          }),
      );
    }
    return new Promise<Response>((resolve) => {
      releaseFirst = () => {
        void inject(url, init).then(resolve);
      };
    });
  }) as unknown as typeof fetch;

  return {
    app,
    db,
    adapter: new ServerSyncAdapter("http://capacitylens.test", fetchImpl),
    waitForFirstBatch: () => vi.waitFor(() => expect(releaseFirst).toBeTypeOf("function")),
    releaseFirstBatch: () => releaseFirst!(),
  };
}

describe("ServerSyncAdapter ordered batch integration", () => {
  it.each(["ordinary-first", "teardown-first"] as const)(
    "persists the teardown edit when requests reach real SQLite %s",
    async (arrivalOrder) => {
      const { app, db, adapter, waitForFirstBatch, releaseFirstBatch } = integrationHarness(
        arrivalOrder,
        discipline("Before", TS1),
      );
      await adapter.loadAll("a1");
      const ordinary = adapter.saveAll(withDiscipline(discipline("First", TS2)));
      await waitForFirstBatch();
      const teardown = adapter.saveAll(withDiscipline(discipline("Newest", TS3)), { unload: true });
      releaseFirstBatch();
      await Promise.all([ordinary, teardown]);

      expect(getRow(db, "disciplines", "d1")).toMatchObject({ name: "Newest" });
      await app.close();
      db.close();
    },
  );

  it.each(["ordinary-first", "teardown-first"] as const)(
    "does not resurrect an unacknowledged non-lifecycle creation when requests arrive %s",
    async (arrivalOrder) => {
      const { app, db, adapter, waitForFirstBatch, releaseFirstBatch } = integrationHarness(arrivalOrder);
      await adapter.loadAll("a1");
      const ordinary = adapter.saveAll(withDiscipline(discipline("Temporary", TS2)));
      await waitForFirstBatch();
      const teardown = adapter.saveAll(withDiscipline(), { unload: true });
      releaseFirstBatch();
      await Promise.all([ordinary, teardown]);

      expect(getRow(db, "disciplines", "d1")).toBeUndefined();
      await app.close();
      db.close();
    },
  );
});
