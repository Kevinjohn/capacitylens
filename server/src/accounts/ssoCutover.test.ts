import { describe, expect, it } from "vitest";
import type { AuthProviderInfo } from "../auth";
import type { SsoCutoverIdentityFacts } from "./betterAuthIdentityPort";
import type { SsoCutoverWorkspaceFact } from "./sqliteAccountAdminPort";
import { evaluateSsoCutoverReadiness, formatSsoCutoverRefusal } from "./ssoCutover";

const provider: AuthProviderInfo = {
  id: "workforce",
  label: "Workforce SSO",
  kind: "oidc",
  experimental: false,
};

const workspace: SsoCutoverWorkspaceFact = {
  workspaceId: "workspace-1",
  workspaceName: "Studio North",
  members: [{ principalId: "owner-1", role: "owner", status: "active" }],
};

const identity: SsoCutoverIdentityFacts = {
  principals: [
    {
      id: "owner-1",
      email: "owner@example.com",
      displayName: "Owner",
      providerIds: ["credential", provider.id],
    },
  ],
  requiredProviderLinks: [
    {
      rowId: "link-1",
      principalId: "owner-1",
      subject: "subject-1",
      verified: true,
    },
  ],
  alternativeProviderLinks: [],
  outstandingResetPrincipalIds: [],
};

function evaluate(
  overrides: {
    workspaces?: readonly SsoCutoverWorkspaceFact[];
    identity?: SsoCutoverIdentityFacts;
    providers?: readonly AuthProviderInfo[];
    openSignup?: boolean;
  } = {},
) {
  return evaluateSsoCutoverReadiness({
    provider,
    providers: overrides.providers ?? [provider],
    workspaces: overrides.workspaces ?? [workspace],
    identity: overrides.identity ?? identity,
    openSignup: overrides.openSignup ?? false,
  });
}

describe("SSO cutover readiness", () => {
  it("passes only when every workspace member has one verified required-provider link", () => {
    const result = evaluate();

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.workspaces[0]).toMatchObject({ ready: true });
    expect(result.workspaces[0]?.members[0]).toMatchObject({
      email: "owner@example.com",
      role: "owner",
      linked: true,
      blocking: false,
      critical: true,
      reason: "ready",
    });
  });

  it.each([
    ["principal_missing", { ...identity, principals: [] }],
    ["member_not_linked", { ...identity, requiredProviderLinks: [] }],
    [
      "multiple_required_provider_links",
      {
        ...identity,
        requiredProviderLinks: [
          ...identity.requiredProviderLinks,
          { rowId: "link-2", principalId: "owner-1", subject: "subject-2", verified: true },
        ],
      },
    ],
    [
      "unverified_provider_link",
      {
        ...identity,
        requiredProviderLinks: [{ ...identity.requiredProviderLinks[0]!, verified: false }],
      },
    ],
  ] as const)("names a blocking Owner with reason %s", (reason, changedIdentity) => {
    const result = evaluate({ identity: changedIdentity });

    expect(result.ready).toBe(false);
    expect(result.workspaces[0]?.members[0]).toMatchObject({
      blocking: true,
      critical: true,
      linked: reason !== "member_not_linked",
      reason,
    });
    expect(formatSsoCutoverRefusal(result)).toContain(
      reason === "principal_missing" ? "owner-1 (owner)" : "owner@example.com (owner)",
    );
  });

  it("detects duplicate subjects across principals", () => {
    const result = evaluate({
      identity: {
        ...identity,
        principals: [
          ...identity.principals,
          { id: "admin-1", email: "admin@example.com", displayName: null, providerIds: [provider.id] },
        ],
        requiredProviderLinks: [
          ...identity.requiredProviderLinks,
          { rowId: "link-2", principalId: "admin-1", subject: "subject-1", verified: true },
        ],
      },
      workspaces: [
        {
          ...workspace,
          members: [...workspace.members, { principalId: "admin-1", role: "admin", status: "active" }],
        },
      ],
    });

    expect(result.workspaces[0]?.members.map(({ reason }) => reason)).toEqual([
      "duplicate_provider_subject",
      "duplicate_provider_subject",
    ]);
  });

  it("reports ownerless and memberless product workspaces", () => {
    const result = evaluate({
      workspaces: [
        { workspaceId: "empty", workspaceName: "Empty", members: [] },
        {
          workspaceId: "ownerless",
          workspaceName: "Ownerless",
          members: [{ principalId: "owner-1", role: "admin", status: "active" }],
        },
      ],
    });

    expect(result.issues.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining(["workspace_has_no_members", "workspace_has_no_owner"]),
    );
  });

  it("reports live reset ceremonies without blocking the atomic cutover revocation", () => {
    const result = evaluate({
      identity: { ...identity, outstandingResetPrincipalIds: ["owner-1"] },
    });

    expect(result.ready).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        reason: "outstanding_password_reset",
        principalId: "owner-1",
        blocking: false,
        critical: false,
      }),
    );
  });

  it("allows configured social links but blocks links to unconfigured providers", () => {
    const result = evaluate({
      openSignup: true,
      identity: {
        ...identity,
        principals: [
          ...identity.principals,
          {
            id: "orphan-1",
            email: "former@example.com",
            displayName: null,
            providerIds: ["credential"],
          },
        ],
        alternativeProviderLinks: [
          { rowId: "github-link", principalId: "owner-1", providerId: "github", subject: "github-subject" },
        ],
        outstandingResetPrincipalIds: ["owner-1"],
      },
    });

    expect(result.issues.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining([
        "alternative_provider_linked",
        "credential_only_orphan",
        "open_signup_enabled",
        "outstanding_password_reset",
      ]),
    );
    expect(formatSsoCutoverRefusal(result)).toContain("former@example.com");
    expect(formatSsoCutoverRefusal(result)).toContain("owner@example.com");
    expect(result.workspaces[0]?.members[0]?.repairLinks).toEqual([
      { rowId: "github-link", providerId: "github", subject: "github-subject" },
    ]);

    const configured = evaluate({
      providers: [provider, { id: "github", label: "GitHub", kind: "social", experimental: true }],
      identity: {
        ...identity,
        alternativeProviderLinks: [
          { rowId: "github-link", principalId: "owner-1", providerId: "github", subject: "github-subject" },
        ],
      },
    });
    expect(configured.ready).toBe(true);
  });

  it("reports an unsupported provider link before a missing required-provider link", () => {
    const result = evaluate({
      workspaces: [
        {
          ...workspace,
          members: [{ principalId: "member-1", role: "viewer", status: "active" }],
        },
      ],
      identity: {
        principals: [
          {
            id: "member-1",
            email: "member@example.com",
            displayName: "Member",
            providerIds: ["github"],
          },
        ],
        requiredProviderLinks: [],
        alternativeProviderLinks: [
          { rowId: "github-link", principalId: "member-1", providerId: "github", subject: "github-subject" },
        ],
        outstandingResetPrincipalIds: [],
      },
    });

    expect(result.workspaces[0]?.members[0]).toMatchObject({
      blocking: true,
      critical: true,
      linked: false,
      reason: "alternative_provider_linked",
      repairLinks: [{ rowId: "github-link", providerId: "github", subject: "github-subject" }],
    });
  });

  it("blocks a providerless orphan principal", () => {
    const result = evaluate({
      identity: {
        ...identity,
        principals: [
          ...identity.principals,
          { id: "orphan-1", email: "former@example.com", displayName: null, providerIds: [] },
        ],
      },
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        reason: "providerless_orphan",
        principalId: "orphan-1",
        critical: true,
      }),
    );
    expect(formatSsoCutoverRefusal(result)).toContain("former@example.com");
  });

  it("blocks an unverified strict-provider link owned by a non-member principal", () => {
    const result = evaluate({
      identity: {
        ...identity,
        principals: [
          ...identity.principals,
          {
            id: "pending-invitee",
            email: "pending@example.com",
            displayName: "Pending Invitee",
            providerIds: [provider.id],
          },
        ],
        requiredProviderLinks: [
          ...identity.requiredProviderLinks,
          {
            rowId: "legacy-link",
            principalId: "pending-invitee",
            subject: "legacy-subject",
            verified: false,
          },
        ],
      },
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        reason: "unverified_provider_link",
        principalId: "pending-invitee",
        blocking: true,
        critical: true,
      }),
    );
    expect(formatSsoCutoverRefusal(result)).toContain("pending@example.com");
    expect(formatSsoCutoverRefusal(result)).toContain("workforce link with subject legacy-subject");
  });

  it("blocks a configured-social-only non-member before they can provision an Owner membership", () => {
    const result = evaluate({
      providers: [provider, { id: "github", label: "GitHub", kind: "social", experimental: true }],
      identity: {
        ...identity,
        principals: [
          ...identity.principals,
          {
            id: "social-only",
            email: "social@example.com",
            displayName: "Social Only",
            providerIds: ["github"],
          },
        ],
        alternativeProviderLinks: [
          {
            rowId: "github-link",
            principalId: "social-only",
            providerId: "github",
            subject: "github-subject",
          },
        ],
      },
    });

    expect(result.ready).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        reason: "member_not_linked",
        principalId: "social-only",
        blocking: true,
      }),
    );
    expect(formatSsoCutoverRefusal(result)).toContain("alternative provider(s): github");
  });
});
