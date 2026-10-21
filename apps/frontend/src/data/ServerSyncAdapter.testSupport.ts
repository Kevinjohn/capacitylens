import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { vi } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Account, Allocation, AppData, Client, Project, TimeOff } from "@capacitylens/shared/types/entities";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import { isRecord } from "@capacitylens/shared/lib/isRecord";

/** First timestamp shared by server-sync adapter fixtures. */
export const TS1 = "2026-01-01T00:00:00.000Z";
/** Second timestamp shared by server-sync adapter fixtures. */
export const TS2 = "2026-01-02T00:00:00.000Z";
/** Builds a client row for server-sync adapter fixtures. */
export const client = (id: string, updatedAt = TS1): Client => ({
  ...NULLABLE_FIELDS.clients,
  id,
  accountId: "a1",
  name: "Ferris",
  color: "#3b82f6",
  createdAt: TS1,
  updatedAt,
});
/** Builds a project row linked to a fixture client. */
export const project = (id: string, clientId: string, updatedAt = TS1): Project => ({
  ...NULLABLE_FIELDS.projects,
  id,
  accountId: "a1",
  name: "Web",
  clientId,
  color: "#3b82f6",
  createdAt: TS1,
  updatedAt,
});
/** Builds an allocation row for batch persistence tests. */
export const allocation = (id: string, startDate: Allocation["startDate"]): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
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
/** Builds a time-off row for batch persistence tests. */
export const timeOff = (id: string, startDate: TimeOff["startDate"], note?: string): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
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

/** Combines partial fixture data with the empty application data shape. */
export const withData = (over: Partial<AppData>): AppData => ({
  ...emptyAppData(),
  ...over,
});
/** Builds a workspace account row for persistence fixtures. */
export const account = (id: string): Account => ({
  ...NULLABLE_FIELDS.accounts,
  id,
  name: `Account ${id}`,
  color: "#5c34d4",
  createdAt: TS1,
  updatedAt: TS1,
});
/** Builds account-scoped fixture data from partial table overrides. */
export const scopedData = (accountId: string, over: Partial<AppData>): AppData =>
  withData({
    ...over,
    accounts: [account(accountId)],
    clients: [
      ...(over.clients ?? []),
      {
        ...NULLABLE_FIELDS.clients,
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

/** Removes selected table keys to model an older server response. */
export const omitKeys = (data: AppData, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));

/** Recorded batch operation and its optional row or revision metadata. */
export interface ReceiptOp {
  method: string;
  table: string;
  id: string;
  accountId?: string;
  updatedAt?: string;
  row?: object;
}

/** Narrows an unknown test value to a record or throws the supplied message. */
export const requiredRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(message);
  return value;
};

/** Narrows an unknown test value to a string or throws the supplied message. */
export const requiredString = (value: unknown, message: string): string => {
  if (typeof value !== "string") throw new Error(message);
  return value;
};

/** Parses and validates the JSON operations in a recorded batch request. */
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

/** Reads parsed operations from a fetch request init object. */
export const opsFromInit = (init?: RequestInit): ReceiptOp[] => parseReceiptOps(init?.body);

const receiptOpsFromInit = (init?: RequestInit): ReceiptOp[] => {
  if (init?.body === undefined) return [];
  if (typeof init.body !== "string") throw new Error("expected a string request body");
  const payload = requiredRecord(JSON.parse(init.body), "expected a request payload object");
  if ("ops" in payload) return parseReceiptOps(init.body);
  requiredString(payload.accountId, "expected a lifecycle account id");
  return [];
};

/** Builds the committed revision for a recorded batch operation. */
export const revisionFor = (op: ReceiptOp) => {
  const row = op.row === undefined ? undefined : requiredRecord(op.row, "expected revision row object");
  return {
    table: op.table,
    id: op.id,
    createdAt: typeof row?.createdAt === "string" ? row.createdAt : TS1,
    updatedAt: typeof row?.updatedAt === "string" ? row.updatedAt : TS1,
  };
};

/** Creates a successful batch receipt for the operations in a request. */
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

/** Returns a present fixture value or throws with the supplied message. */
export const required = <T>(value: T | null | undefined, message = "expected test value to be present"): T => {
  if (value === undefined || value === null) throw new Error(message);
  return value;
};

/** Extracts parsed operations from a recorded batch fetch call. */
export const batchOps = (call: unknown[] | undefined): ReceiptOp[] => {
  if (!call) throw new Error("expected a recorded batch call");
  const init = requiredRecord(call[1], "expected recorded batch request init");
  return parseReceiptOps(init.body);
};

/** Saves fixture data using a server receipt for the resulting batch. */
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

/** Creates a fetch mock that returns successful batch receipts. */
export function okFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => commitReceipt(init));
}
