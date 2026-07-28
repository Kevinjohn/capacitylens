import { describe, expect, it } from "vitest";
import { buildApp, MAX_SERVER_CONNECTIONS } from "./app";
import { openDb } from "./db";

describe("process resource limits", () => {
  it("pins finite request, socket, body, and accepted-connection limits", async () => {
    const db = openDb(":memory:");
    const app = buildApp(db);
    expect(MAX_SERVER_CONNECTIONS).toBe(512);
    expect(app.server.maxConnections).toBe(MAX_SERVER_CONNECTIONS);
    expect(app.initialConfig.bodyLimit).toBe(5 * 1024 * 1024);
    expect(app.initialConfig.connectionTimeout).toBe(30_000);
    expect(app.server.requestTimeout).toBe(30_000);
    await app.close();
    db.close();
  });
});
