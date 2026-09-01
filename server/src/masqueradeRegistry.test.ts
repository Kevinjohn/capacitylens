import { describe, expect, it, vi } from "vitest";
import { MasqueradeRegistry, type MasqueradeRecord } from "./masqueradeRegistry";

const record = (overrides: Partial<MasqueradeRecord> = {}): MasqueradeRecord => ({
  sessionHandle: "session-1",
  userId: "user-1",
  accountId: "account-1",
  targetUserId: "user-2",
  token: "token-1",
  startedAt: "2026-09-01T10:00:00.000Z",
  expiresAt: "2099-09-01T22:00:00.000Z",
  ...overrides,
});

describe("MasqueradeRegistry", () => {
  it("enqueues the start event before publishing the record", () => {
    const registry = new MasqueradeRegistry({ now: () => Date.parse("2026-09-01T11:00:00.000Z") });
    const beforeStart = vi.fn(() => expect(registry.peek("session-1")).toBeNull());

    registry.start(record(), beforeStart);

    expect(beforeStart).toHaveBeenCalledOnce();
    expect(registry.peek("session-1")).toMatchObject({ token: "token-1", phase: "active" });
  });

  it("publishes nothing when start auditing fails", () => {
    const registry = new MasqueradeRegistry();
    expect(() =>
      registry.start(record(), () => {
        throw new Error("audit unavailable");
      }),
    ).toThrow("audit unavailable");
    expect(registry.peek("session-1")).toBeNull();
  });

  it("keeps a failed end in the guarded ending phase and retries it", () => {
    const registry = new MasqueradeRegistry();
    registry.start(record(), () => undefined);
    const failedAudit = vi.fn(() => {
      throw new Error("audit unavailable");
    });

    expect(() => registry.end("session-1", "token-1", failedAudit)).toThrow("audit unavailable");
    expect(registry.peek("session-1")?.phase).toBe("ending");

    const retryAudit = vi.fn();
    expect(registry.end("session-1", "token-1", retryAudit)).toBe(true);
    expect(retryAudit).toHaveBeenCalledOnce();
    expect(registry.peek("session-1")).toBeNull();
  });

  it("treats a stale token as an idempotent no-op", () => {
    const registry = new MasqueradeRegistry();
    registry.start(record(), () => undefined);
    const beforeEnd = vi.fn();

    expect(registry.end("session-1", "stale-token", beforeEnd)).toBe(false);
    expect(beforeEnd).not.toHaveBeenCalled();
    expect(registry.peek("session-1")?.phase).toBe("active");
  });

  it("keeps separate sessions for the same principal isolated", () => {
    const registry = new MasqueradeRegistry();
    registry.start(record(), () => undefined);
    registry.start(record({ sessionHandle: "session-2", token: "token-2" }), () => undefined);

    registry.end("session-1", "token-1", () => undefined);

    expect(registry.peek("session-1")).toBeNull();
    expect(registry.peek("session-2")?.token).toBe("token-2");
  });

  it("returns a detached snapshot of one principal's handles for lifecycle cleanup", () => {
    const registry = new MasqueradeRegistry();
    registry.start(record(), () => undefined);
    registry.start(record({ sessionHandle: "session-2", token: "token-2" }), () => undefined);

    const handles = registry.sessionHandlesForUser("user-1");
    registry.end("session-1", null, () => undefined);

    expect(handles).toEqual(["session-1", "session-2"]);
    expect(registry.sessionHandlesForUser("user-1")).toEqual(["session-2"]);
  });

  it("retains a prepared end until the surrounding session transaction commits", () => {
    const registry = new MasqueradeRegistry();
    registry.start(record({ expiresAt: "2026-09-01T22:00:00.000Z" }), () => undefined);

    expect(registry.prepareEnd("session-1", null, () => undefined)).toBe(true);
    expect(registry.peek("session-1")?.phase).toBe("ending");

    registry.commitEnd(["session-1"]);
    expect(registry.peek("session-1")).toBeNull();
  });

  it("audits and removes expired records before returning a lookup", () => {
    const expired = vi.fn();
    const registry = new MasqueradeRegistry({
      now: () => Date.parse("2026-09-02T00:00:00.000Z"),
      expired,
    });
    registry.start(record({ expiresAt: "2026-09-01T22:00:00.000Z" }), () => undefined);

    expect(registry.lookup("session-1")).toBeNull();
    expect(expired).toHaveBeenCalledWith(expect.objectContaining({ sessionHandle: "session-1" }));
  });

  it("expires only the requested handle on lookup", () => {
    let now = Date.parse("2026-09-01T11:00:00.000Z");
    const expired = vi.fn();
    const registry = new MasqueradeRegistry({ now: () => now, expired });
    registry.start(record({ expiresAt: "2026-09-01T22:00:00.000Z" }), () => undefined);
    registry.start(
      record({ sessionHandle: "session-2", token: "token-2", expiresAt: "2026-09-01T22:00:00.000Z" }),
      () => undefined,
    );
    now = Date.parse("2026-09-02T00:00:00.000Z");

    expect(registry.lookup("session-2")).toBeNull();
    expect(registry.peek("session-1")).not.toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledWith(expect.objectContaining({ sessionHandle: "session-2" }));
  });

  it("sweeps expired handles before starting a new record", () => {
    let now = Date.parse("2026-09-01T11:00:00.000Z");
    const expired = vi.fn();
    const registry = new MasqueradeRegistry({ now: () => now, expired });
    registry.start(record({ expiresAt: "2026-09-01T22:00:00.000Z" }), () => undefined);
    registry.start(
      record({ sessionHandle: "session-2", token: "token-2", expiresAt: "2026-09-01T22:00:00.000Z" }),
      () => undefined,
    );
    now = Date.parse("2026-09-02T00:00:00.000Z");

    registry.start(
      record({ sessionHandle: "session-3", token: "token-3", expiresAt: "2026-09-03T00:00:00.000Z" }),
      () => undefined,
    );

    expect(registry.peek("session-1")).toBeNull();
    expect(registry.peek("session-2")).toBeNull();
    expect(registry.peek("session-3")).not.toBeNull();
    expect(expired).toHaveBeenCalledTimes(2);
  });
});
