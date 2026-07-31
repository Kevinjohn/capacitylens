import { afterEach, describe, expect, it, vi } from "vitest";
import { announceAuditWarning, AUDIT_WARNING_EVENT } from "./auditWarning";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auditWarning", () => {
  it("uses the stable, namespaced event name", () => {
    expect(AUDIT_WARNING_EVENT).toBe("capacitylens:audit-warning");
  });

  it("dispatches the stable operational warning event", () => {
    const listener = vi.fn();
    globalThis.addEventListener(AUDIT_WARNING_EVENT, listener);
    try {
      announceAuditWarning();
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0]?.[0]).toBeInstanceOf(Event);
      expect(listener.mock.calls[0]?.[0].type).toBe(AUDIT_WARNING_EVENT);
    } finally {
      globalThis.removeEventListener(AUDIT_WARNING_EVENT, listener);
    }
  });

  it("tolerates environments without a global dispatchEvent", () => {
    vi.stubGlobal("dispatchEvent", undefined);

    expect(() => announceAuditWarning()).not.toThrow();
  });
});
