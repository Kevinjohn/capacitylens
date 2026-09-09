import { describe, expect, it } from "vitest";
import { parseWorkspaceReadiness, resolveReadinessMemberLabel, type ReadinessMember } from "./ssoReadiness";

interface ValidIssue {
  message: string;
  reason: string;
  blocking: boolean;
  critical: boolean;
  workspaceId: string | null;
  principalId: string | null;
}

interface ValidPayload {
  ready: boolean;
  provider: { id: string; label: string; kind: string; experimental: boolean };
  members: ReadinessMember[];
  issues: ValidIssue[];
  globalIssues: ValidIssue[];
}

function createValidPayload(): ValidPayload {
  return {
    ready: false,
    provider: { id: "northwind", label: "Northwind Identity", kind: "oidc", experimental: false },
    members: [
      {
        principalId: "bruce-wayne",
        email: null,
        displayName: null,
        role: "owner",
        linked: true,
        blocking: false,
        critical: false,
        reason: "ready",
        repairLinks: [{ rowId: "link-1", providerId: "northwind", subject: "bruce" }],
      },
    ],
    issues: [
      {
        message: "A workspace issue",
        reason: "member_not_linked",
        blocking: true,
        critical: false,
        workspaceId: null,
        principalId: null,
      },
    ],
    globalIssues: [
      {
        message: "A global issue",
        reason: "open_signup_enabled",
        blocking: true,
        critical: true,
        workspaceId: null,
        principalId: null,
      },
    ],
  };
}

type PayloadMutation = (payload: ValidPayload) => unknown;

function withMutation(mutate: PayloadMutation): unknown {
  return mutate(structuredClone(createValidPayload()));
}

const invalidPayloadCases = [
  ["a null top-level value", () => null],
  ["an array top-level value", () => []],
  ["a string top-level value", () => "readiness"],
  ["a non-boolean ready flag", (payload) => ({ ...payload, ready: "false" })],
  ["a non-object provider", (payload) => ({ ...payload, provider: null })],
  ["a provider with a malformed id", (payload) => ({ ...payload, provider: { ...payload.provider, id: null } })],
  ["a provider with a malformed label", (payload) => ({ ...payload, provider: { ...payload.provider, label: false } })],
  ["a provider with an invalid kind", (payload) => ({ ...payload, provider: { ...payload.provider, kind: "saml" } })],
  [
    "a provider with an experimental flag",
    (payload) => ({ ...payload, provider: { ...payload.provider, experimental: true } }),
  ],
  ["a non-array member collection", (payload) => ({ ...payload, members: {} })],
  ["a null member entry", (payload) => ({ ...payload, members: [null] })],
  [
    "a member with a malformed principal id",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], principalId: null }] }),
  ],
  [
    "a member with an invalid role",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], role: "operator" }] }),
  ],
  [
    "a member with an invalid reason",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], reason: "unknown" }] }),
  ],
  [
    "a member with a non-boolean linked flag",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], linked: "true" }] }),
  ],
  [
    "a member with a non-boolean blocking flag",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], blocking: "false" }] }),
  ],
  [
    "a member with a non-boolean critical flag",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], critical: 0 }] }),
  ],
  [
    "a member with a malformed nullable email",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], email: 1 }] }),
  ],
  [
    "a member with a malformed nullable display name",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], displayName: false }] }),
  ],
  [
    "a non-array repair-link collection",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], repairLinks: {} }] }),
  ],
  [
    "a null repair-link entry",
    (payload) => ({ ...payload, members: [{ ...payload.members[0], repairLinks: [null] }] }),
  ],
  [
    "an empty repair-link row id",
    (payload) => ({
      ...payload,
      members: payload.members.map((member) => ({
        ...member,
        repairLinks: member.repairLinks.map((link) => ({ ...link, rowId: "" })),
      })),
    }),
  ],
  [
    "an empty repair-link provider id",
    (payload) => ({
      ...payload,
      members: payload.members.map((member) => ({
        ...member,
        repairLinks: member.repairLinks.map((link) => ({ ...link, providerId: "" })),
      })),
    }),
  ],
  [
    "an empty repair-link subject",
    (payload) => ({
      ...payload,
      members: payload.members.map((member) => ({
        ...member,
        repairLinks: member.repairLinks.map((link) => ({ ...link, subject: "" })),
      })),
    }),
  ],
  [
    "a non-string repair-link row id",
    (payload) => ({
      ...payload,
      members: payload.members.map((member) => ({
        ...member,
        repairLinks: member.repairLinks.map((link) => ({ ...link, rowId: null })),
      })),
    }),
  ],
  [
    "a non-string repair-link provider id",
    (payload) => ({
      ...payload,
      members: payload.members.map((member) => ({
        ...member,
        repairLinks: member.repairLinks.map((link) => ({ ...link, providerId: false })),
      })),
    }),
  ],
  [
    "a non-string repair-link subject",
    (payload) => ({
      ...payload,
      members: payload.members.map((member) => ({
        ...member,
        repairLinks: member.repairLinks.map((link) => ({ ...link, subject: 0 })),
      })),
    }),
  ],
  ["a non-array issue collection", (payload) => ({ ...payload, issues: {} })],
  ["a null issue entry", (payload) => ({ ...payload, issues: [null] })],
  [
    "an issue with a malformed message",
    (payload) => ({ ...payload, issues: [{ ...payload.issues[0], message: null }] }),
  ],
  [
    "an issue with an invalid reason",
    (payload) => ({ ...payload, issues: [{ ...payload.issues[0], reason: "unknown" }] }),
  ],
  [
    "an issue with a non-boolean blocking flag",
    (payload) => ({ ...payload, issues: [{ ...payload.issues[0], blocking: "true" }] }),
  ],
  [
    "an issue with a non-boolean critical flag",
    (payload) => ({ ...payload, issues: [{ ...payload.issues[0], critical: 0 }] }),
  ],
  [
    "an issue with a malformed nullable workspace id",
    (payload) => ({ ...payload, issues: [{ ...payload.issues[0], workspaceId: 1 }] }),
  ],
  [
    "an issue with a malformed nullable principal id",
    (payload) => ({ ...payload, issues: [{ ...payload.issues[0], principalId: false }] }),
  ],
  ["a non-array global-issue collection", (payload) => ({ ...payload, globalIssues: {} })],
  ["a null global-issue entry", (payload) => ({ ...payload, globalIssues: [null] })],
  [
    "a global issue with a malformed message",
    (payload) => ({ ...payload, globalIssues: [{ ...payload.globalIssues[0], message: null }] }),
  ],
  [
    "a global issue with an invalid reason",
    (payload) => ({ ...payload, globalIssues: [{ ...payload.globalIssues[0], reason: "unknown" }] }),
  ],
  [
    "a global issue with a non-boolean blocking flag",
    (payload) => ({ ...payload, globalIssues: [{ ...payload.globalIssues[0], blocking: "true" }] }),
  ],
  [
    "a global issue with a non-boolean critical flag",
    (payload) => ({ ...payload, globalIssues: [{ ...payload.globalIssues[0], critical: 0 }] }),
  ],
  [
    "a global issue with a malformed nullable workspace id",
    (payload) => ({ ...payload, globalIssues: [{ ...payload.globalIssues[0], workspaceId: 1 }] }),
  ],
  [
    "a global issue with a malformed nullable principal id",
    (payload) => ({ ...payload, globalIssues: [{ ...payload.globalIssues[0], principalId: false }] }),
  ],
] satisfies readonly [string, PayloadMutation][];

describe("parseWorkspaceReadiness", () => {
  it("accepts the unchanged valid payload with nullable member identity fields", () => {
    const payload = createValidPayload();

    expect(parseWorkspaceReadiness(payload)).toEqual(payload);
  });

  it("accepts nonempty issue coordinates", () => {
    const payload = createValidPayload();
    payload.issues = payload.issues.map((issue) => ({ ...issue, workspaceId: "a-studio", principalId: "bruce-wayne" }));

    expect(parseWorkspaceReadiness(payload)).toEqual(payload);
  });

  it("accepts valid data with nullable identity fields and preserves allowed empty strings", () => {
    const payload = createValidPayload();
    payload.provider.id = "";
    payload.provider.label = "";
    payload.members = payload.members.map((member) => ({ ...member, principalId: "", email: "", displayName: "" }));
    payload.issues = payload.issues.map((issue) => ({ ...issue, message: "" }));

    expect(parseWorkspaceReadiness(payload)).toEqual(payload);
  });

  it.each(invalidPayloadCases)("rejects %s", (_description, mutate) => {
    expect(parseWorkspaceReadiness(withMutation(mutate))).toBeNull();
  });
});

describe("resolveReadinessMemberLabel", () => {
  const member: ReadinessMember = {
    principalId: "bruce-wayne",
    email: null,
    displayName: null,
    role: "owner",
    linked: true,
    blocking: false,
    critical: false,
    reason: "ready",
    repairLinks: [{ rowId: "link-1", providerId: "northwind", subject: "bruce" }],
  };

  it.each([
    [
      "the email when present",
      { ...member, email: "bruce@wayne.example", displayName: "Bruce Wayne" },
      "bruce@wayne.example",
    ],
    ["the display name when email is null", { ...member, email: null, displayName: "Bruce Wayne" }, "Bruce Wayne"],
    ["the principal id when identity labels are null", { ...member, email: null, displayName: null }, "bruce-wayne"],
    ["an empty email without falling back", { ...member, email: "", displayName: "Bruce Wayne" }, ""],
    ["an empty display name without falling back", { ...member, email: null, displayName: "" }, ""],
  ] satisfies readonly [string, ReadinessMember, string][])("uses %s", (_description, input, expected) => {
    expect(resolveReadinessMemberLabel(input)).toBe(expected);
  });
});
