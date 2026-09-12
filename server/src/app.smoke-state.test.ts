import { describe, it, expect } from "vitest";
import { freshApp } from "./fixtures/appTestEntities";
import { call } from "./fixtures/appTestHttp";
import { readValidatedState } from "./fixtures/appTestSnapshotBatch";

describe("health + state", () => {
  it("reports health and starts empty", async () => {
    const { app } = freshApp();
    expect((await call(app, { method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
    const s = await readValidatedState(app);
    expect(s.accounts).toEqual([]);
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: false });
  });
});

describe("request/connection timeouts (slowloris guard for the direct-exposure deploy)", () => {
  it("bounds both requestTimeout and connectionTimeout — Fastify defaults both to 0 (disabled)", () => {
    const { app } = freshApp();
    // initialConfig's TS typing omits requestTimeout (a Fastify 5 typings gap — it's present at
    // runtime, ajv-defaulted like every other init option), so assert against the raw Node server
    // Fastify actually configures: requestTimeout is a direct assignment, connectionTimeout is
    // applied via server.setTimeout() (which Node mirrors onto the `timeout` property).
    expect(app.initialConfig.connectionTimeout).toBe(30_000);
    expect(app.server.requestTimeout).toBe(30_000);
    expect(app.server.timeout).toBe(30_000);
  });
});
