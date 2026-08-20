import { describe, it, expect } from "vitest";
import { errorMessage, domainErrorMessage } from "./errorMessage";
import { DomainError, type DomainErrorCode } from "@capacitylens/shared/domain/errors";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";

describe("errorMessage", () => {
  it("normalises an Error, a string, a React Router ErrorResponse, and unknown throws", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ statusText: "Not Found" })).toBe("Not Found");
    expect(errorMessage(null)).toBe("An unexpected error occurred.");
    expect(errorMessage(undefined)).toBe("An unexpected error occurred.");
    expect(errorMessage(42)).toBe("An unexpected error occurred.");
  });

  it.each(["", "   ", new Error(""), new Error("   "), { statusText: "" }])(
    "never returns a blank message for %j",
    (error) => {
      expect(errorMessage(error)).toBe("An unexpected error occurred.");
    },
  );

  it("falls back to the generic message when statusText is present but not a string", () => {
    // Exercises the `typeof statusText === 'string'` guard specifically (as opposed to the
    // earlier `'statusText' in error` check, which alone would let a non-string through).
    expect(errorMessage({ statusText: 123 })).toBe("An unexpected error occurred.");
  });

  it("remains total for hostile proxies whose traps throw", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("prototype denied");
        },
        has: () => {
          throw new Error("membership denied");
        },
        get: () => {
          throw new Error("read denied");
        },
      },
    );

    expect(errorMessage(hostile)).toBe("An unexpected error occurred.");
  });

  it("snapshots a stateful Proxy statusText once before validating it", () => {
    let reads = 0;
    const stateful = new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property !== "statusText") return undefined;
          reads += 1;
          return reads === 1 ? "Temporarily unavailable" : { changed: true };
        },
      },
    );

    expect(errorMessage(stateful)).toBe("Temporarily unavailable");
    expect(reads).toBe(1);
  });

  it("maps a domain code through translations instead of trusting fallback prose", () => {
    expect(errorMessage(new DomainError("record_wrong_account", "obsolete server wording"))).toBe(
      "That record does not belong to the active company.",
    );
  });
});

describe("domainErrorMessage", () => {
  // Every `DomainErrorCode` (bar `date_span_too_long`, covered separately below) maps to its own
  // fixed, translated string. Pinning the exact text — not just "is a non-empty string" — kills
  // both the StringLiteral mutants on the case labels and the ConditionalExpression mutants that
  // collapse a case into an unconditional fallthrough.
  const fixedMessageCases: Array<[DomainErrorCode, string]> = [
    ["record_wrong_account", "That record does not belong to the active company."],
    ["reference_wrong_account", "That change references data outside the active company."],
    ["activity_project_required", "A project-specific activity must be assigned to a project."],
    ["activity_project_forbidden", "An internal or all-projects activity cannot belong to a project."],
    ["activity_phase_forbidden", "An internal or all-projects activity cannot belong to a phase."],
    ["activity_phase_wrong_account", "Activity phase must belong to this company."],
    ["activity_phase_project_required", "An activity with a phase must also belong to that phase’s project."],
    ["activity_phase_project_mismatch", "Activity phase must belong to the activity’s project."],
    ["resource_project_forbidden", "Only a placeholder can be assigned to a project."],
    ["allocation_references_invalid", "Allocation must reference an existing resource and activity in this company."],
    ["allocation_resource_inactive", "Allocation must reference an active resource in this company."],
    ["allocation_project_inactive", "Allocation must reference an activity under an active project in this company."],
    ["allocation_activity_inactive", "Allocation must reference an activity under an active project."],
    ["placeholder_project_missing", "This placeholder is not bound to a project yet."],
    ["external_allocation_hours", "An external / 3rd-party resource’s allocation can’t carry hours."],
    ["resource_external_dependents", "Reassign or remove this resource’s work and time off before making it external."],
    ["placeholder_project_dependents", "Reassign or remove this placeholder’s work before changing its bound project."],
    ["activity_project_dependents", "Reassign placeholder work before changing this activity’s project."],
    ["date_required", "Start and end dates are required."],
    ["date_invalid", "Dates must be valid calendar dates (YYYY-MM-DD)."],
    ["date_reversed", "End date cannot be before the start date."],
    ["time_off_resource_invalid", "Time off must reference an existing resource in this company."],
    ["time_off_resource_inactive", "Time off must reference an active resource in this company."],
    ["time_off_external_resource", "Time off can’t be recorded for an external / 3rd-party resource."],
    ["closure_name_required", "Closure name is required."],
  ];

  it.each(fixedMessageCases)("maps %s to its exact translated message", (code, expected) => {
    expect(domainErrorMessage(code)).toBe(expected);
  });

  it("keeps every code distinct so no two cases share a fallen-through message", () => {
    // Guards against a case label being deleted/blanked out (StringLiteral mutant) and silently
    // falling through to whichever case happens to sit above it in source order.
    const messages = fixedMessageCases.map(([, expected]) => expected);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("interpolates the formatted span limit into date_span_too_long", () => {
    // MAX_SPAN_DAYS is 36_500; toLocaleString("en-GB") groups thousands with a comma, so this
    // pins both the ObjectLiteral (the `{ max }` payload) and StringLiteral ("en-GB") mutants.
    expect(domainErrorMessage("date_span_too_long")).toBe(
      `Date span cannot exceed ${MAX_SPAN_DAYS.toLocaleString("en-GB")} calendar days.`,
    );
    expect(domainErrorMessage("date_span_too_long")).toBe("Date span cannot exceed 36,500 calendar days.");
  });
});

describe("errorMessage edge cases around the plain-object statusText branch", () => {
  it("falls back to generic for a bare object with no statusText", () => {
    expect(errorMessage({})).toBe("An unexpected error occurred.");
  });

  it("falls back to generic for a whitespace-only statusText", () => {
    // Distinguishes the real `statusText.trim()` truthiness check from a mutant that reads
    // `statusText` directly (untrimmed), which would treat "   " as a usable message.
    expect(errorMessage({ statusText: "   " })).toBe("An unexpected error occurred.");
  });

  it("ignores a truthy non-object error even when it carries a statusText property", () => {
    // A function is truthy but `typeof fn === "function"`, not "object", so the real
    // `error && typeof error === "object"` guard must skip it. A mutant that hard-codes this
    // check to `true`, or loosens `&&` to `||`, would instead read the property below and leak
    // it back out.
    const fn = (): void => undefined;
    (fn as unknown as { statusText?: string }).statusText = "leaked from a function";
    expect(errorMessage(fn)).toBe("An unexpected error occurred.");
  });
});
