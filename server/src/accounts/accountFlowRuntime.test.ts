import type { AccountAuditEvent } from "@capacitylens/shared/account/audit";
import { describe, expect, it, vi } from "vitest";
import { createAccountAuditWriter, recordTerminalOutcome } from "./accountFlowRuntime";

function captureError(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("Expected the operation to throw an Error.");
}

describe("account flow runtime helpers", () => {
  it("constructs the shared audit envelope consistently", () => {
    const events: AccountAuditEvent[] = [];
    const append = vi.fn((event: AccountAuditEvent) => {
      events.push(event);
      return true;
    });
    const audit = createAccountAuditWriter("application-1", { append });

    audit({
      action: "flow.reconciliation_required",
      outcome: "failed",
      command: { commandId: "command-1", idempotencyKey: "key-1" },
      targetPrincipalId: "principal-1",
      changedFields: ["commandLedger"],
    });

    expect(append).toHaveBeenCalledOnce();
    expect(events[0]).toMatchObject({
      id: "command-1:flow.reconciliation_required:failed",
      applicationId: "application-1",
      workspaceId: null,
      actorPrincipalId: null,
      targetPrincipalId: "principal-1",
      commandId: "command-1",
      action: "flow.reconciliation_required",
      outcome: "failed",
      changedFields: ["commandLedger"],
    });
    expect(events[0]?.occurredAt).toEqual(expect.any(String));
  });

  it("preserves both the operation and terminal-recording failures", () => {
    const original = new Error("operation failed");
    const recording = new Error("ledger failed");

    const error = captureError(() =>
      recordTerminalOutcome(original, () => {
        throw recording;
      }),
    );

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([original, recording]);
    expect(error.cause).toBe(recording);
  });

  it("treats a rejected conditional terminal write as a recording failure", () => {
    const original = new Error("operation failed");

    const error = captureError(() => recordTerminalOutcome(original, () => false));

    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors as unknown[];
    expect(errors[0]).toBe(original);
    expect(errors[1]).toBeInstanceOf(Error);
    expect((errors[1] as Error).message).toMatch(/no longer accepted/i);
  });
});
