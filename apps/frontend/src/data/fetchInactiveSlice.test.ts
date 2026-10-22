import { describe, it, expect, afterEach, vi } from "vitest";
import { buildBetaExport } from "@capacitylens/shared/data/betaTransfer";
import { seed } from "@capacitylens/shared/data/seed";
import { fetchInactiveSlice, InactiveSliceHttpError, InactiveSliceShapeError } from "./fetchInactiveSlice";

// The shared reader of the purge-gated `?includeInactive=1` admin endpoint. The component suites
// (DeleteCompanyDialog, ArchivedSection) prove each caller's surface; this proves the helper's own
// contract (the request shape, the typed errors and the pre-migrate structural gate) once,
// where both callers inherit it.

afterEach(() => {
  vi.unstubAllGlobals();
});

const ok = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("fetchInactiveSlice", () => {
  it("requests a complete strict inactive slice for the account with credentials", async () => {
    const body = buildBetaExport(seed(), { accountId: "a-studio", completeness: "full" }).data;
    const fetchMock = vi.fn(async () => ok(body));
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const data = await fetchInactiveSlice("a-studio", controller.signal);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/state?accountId=a-studio&includeInactive=1");
    expect(init.credentials).toBe("include");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(data).toEqual(body);
  });

  it("throws InactiveSliceHttpError carrying the status and the server `{ error }` sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "Down for backup." }) })),
    );
    const err = await fetchInactiveSlice("a1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InactiveSliceHttpError);
    expect((err as InactiveSliceHttpError).status).toBe(503);
    expect((err as InactiveSliceHttpError).serverMessage).toBe("Down for backup.");
  });

  it("throws InactiveSliceHttpError with serverMessage undefined when the error body is unreadable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    );
    const err = await fetchInactiveSlice("a1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InactiveSliceHttpError);
    expect((err as InactiveSliceHttpError).status).toBe(403);
    expect((err as InactiveSliceHttpError).serverMessage).toBeUndefined();
  });

  // A partial 200 must not be repaired into an apparently complete backup.
  it("throws InactiveSliceShapeError on a structurally incomplete 200 body", async () => {
    for (const body of [null, [], { definitely: "not CapacityLens" }, { accounts: [{ id: "a1" }] }]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ok(body)),
      );
      await expect(fetchInactiveSlice("a1")).rejects.toBeInstanceOf(InactiveSliceShapeError);
    }
  });

  it("refuses a complete-looking response with invalid lifecycle state or a broken link", async () => {
    const valid = buildBetaExport(seed(), { accountId: "a-studio", completeness: "full" }).data;
    const lifecycle = structuredClone(valid);
    const client = lifecycle.clients[0];
    if (!client) throw new Error("The inactive fixture has no client.");
    Object.assign(client, { archivedAt: "yesterday" });
    const broken = structuredClone(valid);
    const project = broken.projects[0];
    if (!project) throw new Error("The inactive fixture has no project.");
    Object.assign(project, { clientId: "missing-client" });
    for (const body of [lifecycle, broken]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ok(body)),
      );
      await expect(fetchInactiveSlice("a-studio")).rejects.toBeInstanceOf(InactiveSliceShapeError);
    }
  });
});
