import { describe, expect, it, vi } from "vitest";
import { createApp, MAX_SERVER_CONNECTIONS } from "./app";
import { openDb } from "./db";

describe("process resource limits", () => {
  it("pins finite request, socket, body, and accepted-connection limits", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);
    expect(MAX_SERVER_CONNECTIONS).toBe(512);
    expect(app.server.maxConnections).toBe(MAX_SERVER_CONNECTIONS);
    expect(app.initialConfig.bodyLimit).toBe(5 * 1024 * 1024);
    expect(app.initialConfig.connectionTimeout).toBe(30_000);
    expect(app.server.requestTimeout).toBe(30_000);
    await app.close();
    db.close();
  });

  it("rate-limits an operator signal when the accepted-connection ceiling drops sockets", async () => {
    const db = openDb(":memory:");
    const securityLog = vi.fn();
    const app = createApp(db, { securityLog });

    app.server.emit("drop", {} as never);
    app.server.emit("drop", {} as never);

    expect(securityLog).toHaveBeenCalledOnce();
    expect(securityLog).toHaveBeenCalledWith({
      event: "connection_limit",
      outcome: "blocked",
      limit: MAX_SERVER_CONNECTIONS,
    });
    await app.close();
    db.close();
  });
});
