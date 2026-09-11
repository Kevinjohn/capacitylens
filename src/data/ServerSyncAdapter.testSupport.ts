import { vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Account, Allocation, AppData, Client, Project, TimeOff } from "@capacitylens/shared/types/entities";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import { cacheAuthSnapshot, clearAllOfflineData, setOfflineReadState, type OfflineAuthSnapshot } from "./offlineCache";

export const TS1 = "2026-01-01T00:00:00.000Z";
export const TS2 = "2026-01-02T00:00:00.000Z";
export const client = (id: string, updatedAt = TS1): Client => ({
  id,
  accountId: "a1",
  name: "Acme",
  color: "#3b82f6",
  createdAt: TS1,
  updatedAt,
});
export const project = (id: string, clientId: string, updatedAt = TS1): Project => ({
  id,
  accountId: "a1",
  name: "Web",
  clientId,
  color: "#3b82f6",
  createdAt: TS1,
  updatedAt,
});
export const allocation = (id: string, startDate: Allocation["startDate"]): Allocation => ({
  id,
  accountId: "a1",
  resourceId: "r1",
  activityId: "t1",
  startDate,
  endDate: startDate,
  hoursPerDay: 8,
  status: "confirmed",
  createdAt: TS1,
  updatedAt: TS1,
});
export const timeOff = (id: string, startDate: TimeOff["startDate"], note?: string): TimeOff => ({
  id,
  accountId: "a1",
  resourceId: "r1",
  startDate,
  endDate: startDate,
  type: "holiday",
  ...(note === undefined ? {} : { note }),
  createdAt: TS1,
  updatedAt: TS1,
});

export const withData = (over: Partial<AppData>): AppData => ({
  ...emptyAppData(),
  ...over,
});
export const account = (id: string): Account => ({
  id,
  name: `Account ${id}`,
  color: "#5c34d4",
  createdAt: TS1,
  updatedAt: TS1,
});
export const scopedData = (accountId: string, over: Partial<AppData>): AppData =>
  withData({
    ...over,
    accounts: [account(accountId)],
    clients: [
      ...(over.clients ?? []),
      {
        id: `internal:${accountId}`,
        accountId,
        name: "Internal",
        color: "#2d75da",
        builtin: true,
        createdAt: TS1,
        updatedAt: TS1,
      },
    ],
  });

// Drop known table keys from a slice to simulate an OLDER server omitting them (rolling-deploy skew).
export const omitKeys = (data: AppData, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));

export interface ReceiptOp {
  method: string;
  table: string;
  id: string;
  accountId?: string;
  updatedAt?: string;
  row?: object;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const requiredRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(message);
  return value;
};

export const requiredString = (value: unknown, message: string): string => {
  if (typeof value !== "string") throw new Error(message);
  return value;
};

export const parseReceiptOps = (body: unknown): ReceiptOp[] => {
  if (typeof body !== "string") throw new Error("expected a string batch request body");
  const payload = requiredRecord(JSON.parse(body), "expected a batch payload object");
  if (!Array.isArray(payload.ops)) throw new Error("expected a batch ops array");
  return payload.ops.map((value) => {
    const op = requiredRecord(value, "expected a batch op object");
    const accountId = op.accountId === undefined ? undefined : requiredString(op.accountId, "expected account id");
    const updatedAt = op.updatedAt === undefined ? undefined : requiredString(op.updatedAt, "expected update time");
    const row = op.row === undefined ? undefined : requiredRecord(op.row, "expected a batch row object");
    return {
      method: requiredString(op.method, "expected batch method"),
      table: requiredString(op.table, "expected batch table"),
      id: requiredString(op.id, "expected batch id"),
      ...(accountId === undefined ? {} : { accountId }),
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(row === undefined ? {} : { row }),
    };
  });
};

export const opsFromInit = (init?: RequestInit): ReceiptOp[] => parseReceiptOps(init?.body);

export const receiptOpsFromInit = (init?: RequestInit): ReceiptOp[] => {
  if (init?.body === undefined) return [];
  if (typeof init.body !== "string") throw new Error("expected a string request body");
  const payload = requiredRecord(JSON.parse(init.body), "expected a request payload object");
  if ("ops" in payload) return parseReceiptOps(init.body);
  requiredString(payload.accountId, "expected a lifecycle account id");
  return [];
};

export const revisionFor = (op: ReceiptOp) => {
  const row = op.row === undefined ? undefined : requiredRecord(op.row, "expected revision row object");
  return {
    table: op.table,
    id: op.id,
    createdAt: typeof row?.createdAt === "string" ? row.createdAt : TS1,
    updatedAt: typeof row?.updatedAt === "string" ? row.updatedAt : TS1,
  };
};

export const commitReceipt = (init?: RequestInit): Response => {
  const ops = receiptOpsFromInit(init);
  return new Response(
    JSON.stringify({
      ok: true,
      applied: ops.length,
      revisions: ops.filter((op) => op.method === "PUT").map(revisionFor),
      archives: ops
        .filter((op) => op.method === "ARCHIVE")
        .map((op) => ({ table: op.table, id: op.id, archived: true })),
    }),
    { status: 200 },
  );
};

export const required = <T>(value: T | null | undefined, message = "expected test value to be present"): T => {
  if (value === undefined || value === null) throw new Error(message);
  return value;
};

/** The verified `/me` snapshot every offline scenario is cached against. */
const OFFLINE_IDENTITY: OfflineAuthSnapshot = {
  authMode: "password",
  user: {
    id: "offline-user",
    email: "offline@example.test",
    name: "Offline user",
  },
  canCreateAccount: false,
  multiAccount: false,
};

export async function withOfflineCache(run: () => Promise<void>): Promise<void> {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("capacitylens/offlineRead", "on");
  try {
    await cacheAuthSnapshot(OFFLINE_IDENTITY);
    await run();
  } finally {
    await clearAllOfflineData();
    setOfflineReadState("cleanup", false);
    localStorage.clear();
    vi.unstubAllGlobals();
  }
}

// Helper: pull the parsed ops array out of a recorded /api/batch POST.
export const batchOps = (call: unknown[] | undefined): ReceiptOp[] => {
  if (!call) throw new Error("expected a recorded batch call");
  const init = requiredRecord(call[1], "expected recorded batch request init");
  return parseReceiptOps(init.body);
};

export async function saveAgainstReceipt(
  receipt: unknown,
  options: { initial?: AppData; next?: AppData; unload?: boolean } = {},
): Promise<void> {
  const initial = options.initial ?? emptyAppData();
  const next = options.next ?? withData({ clients: [client("c1")] });
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("/api/state")) return new Response(JSON.stringify(initial), { status: 200 });
    return new Response(JSON.stringify(receipt), { status: 200 });
  });
  const adapter = new ServerSyncAdapter("http://api.test", fetchImpl);
  await adapter.loadAll();
  await adapter.saveAll(next, options.unload ? { unload: true } : undefined);
}

export function okFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => commitReceipt(init));
}
