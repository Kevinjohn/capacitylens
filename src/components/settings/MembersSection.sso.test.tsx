import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "../../auth/authContext";
import type { AuthContextValue } from "../../auth/authContext";
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { refreshActiveAccountSlice } from "../../data/persist";
import { setOfflineReadState } from "../../data/offlineCache";
import { m } from "@/i18n";
import { MembersSection } from "./MembersSection";
import {
  authValue,
  findMemberRow,
  mockApi,
  rawMember,
  renderSection,
  requireValue,
  saveRoleVia,
  stubPageReload,
  type RawMember,
} from "./MembersSection.testSupport";

const accountTransitionMocks = vi.hoisted(() => ({
  startMasquerade: vi.fn(async () => true),
}));

vi.mock("../../auth/accountTransition", () => ({
  startMasquerade: accountTransitionMocks.startMasquerade,
}));

// MembersSection is the Team & access management UI. It renders ONLY in auth-on + server mode and
// self-gates via a 403 on the members read. These tests mock apiConfig (so isServerConfigured() is
// true) and fetch, and assert the OWNER-ONLY affordances are hidden for an admin (no owner option, no
// controls on the Owner row), ownership changes only through transfer, and a 403 renders nothing.

// Make the section "enabled": a configured server. The real module reads import.meta.env, which the
// test env leaves unset; mocking it is the clean way to flip server mode on.
vi.mock("../../data/apiConfig", () => ({
  API_BASE: "http://api.test",
  isServerConfigured: () => true,
}));

vi.mock("../../data/persist", () => ({
  refreshActiveAccountSlice: vi.fn(async () => ({ kind: "reloaded" })),
  flushPendingWrites: vi.fn(async () => ({ kind: "clean" })),
  suspendServerWrites: vi.fn(() => vi.fn()),
  switchAndAwaitHydration: vi.fn(async (id: string | null) => {
    useStore.getState().setActiveAccount(id);
    return { kind: "reloaded" };
  }),
}));

beforeEach(() => {
  accountTransitionMocks.startMasquerade.mockClear();
  resetStoreWithAccount(); // sets activeAccountId = DEFAULT_ACCOUNT_ID
  setOfflineReadState("cleanup", false);
  vi.mocked(refreshActiveAccountSlice).mockResolvedValue({ kind: "reloaded" });
});
afterEach(() => {
  setOfflineReadState("cleanup", false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MembersSection — SSO cutover repair", () => {
  const providers: NonNullable<AuthContextValue["providers"]> = [
    { id: "workforce", label: "Workforce SSO", kind: "oidc", experimental: false },
  ];
  const directory = [
    { userId: "me", role: "owner" as const, isSelf: true },
    { userId: "target", role: "admin" as const, isSelf: false },
  ];

  function ssoReadiness(linked: boolean, reason: string) {
    return {
      ready: false,
      provider: { id: "workforce", label: "Workforce SSO", kind: "oidc", experimental: false },
      members: [
        {
          principalId: "target",
          email: "target@x.io",
          displayName: "Target",
          role: "admin",
          linked,
          blocking: true,
          critical: true,
          reason,
          repairLinks: linked ? [{ rowId: "link-1", providerId: "workforce", subject: "subject-1" }] : [],
        },
      ],
      issues: [],
      globalIssues: [],
    };
  }

  function ssoFetch(linked: boolean, reason: string) {
    // A bare "GET " suffix would also swallow the /members read that mockApi's own default already
    // serves, so key this explicitly on the readiness path; PATCH/DELETE fall through to mockApi's
    // built-in 204 fallback for every other write.
    return mockApi(directory, { "GET /sso-readiness": () => jsonResponse(ssoReadiness(linked, reason)) });
  }

  registerSsoDraftTests(directory);
  registerSsoReadinessRefreshTests(directory, providers, ssoReadiness);
  registerSsoEmailRepairTests(providers, ssoFetch);
  registerSsoEmailValidationTests(providers, ssoFetch);
  registerSsoRefusedEmailTest(directory, providers, ssoReadiness);
  registerSsoSelfEmailRepairTests(directory, providers, ssoReadiness);
  registerSsoLinkRepairTests(directory, providers, ssoReadiness);
  registerSsoLinkFailureTest(directory, providers, ssoReadiness);
  registerSsoReadinessLifecycleTests(directory, providers, ssoReadiness);
  registerSsoReadinessFailureTests(directory, providers, ssoReadiness);
  registerSsoModeTests(providers, ssoFetch);
});

function registerSsoDraftTests(directory: RawMember[]): void {
  it("preserves invite and member role drafts when the render children unmount and remount", async () => {
    const user = userEvent.setup();
    const directoryWithTracking = directory.map((member) => ({ ...member, signInConfirmed: true }));
    let membersReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(directoryWithTracking, {
        "GET /members": () => {
          membersReads += 1;
          if (membersReads === 2) return jsonResponse({}, 403);
          return jsonResponse({
            signInTrackingEnabled: true,
            members: directoryWithTracking.map((member) => rawMember(member)),
          });
        },
      }),
    );
    renderSection();

    const inviteEmail = await screen.findByTestId("invite-preauth");
    await user.type(inviteEmail, "draft@example.com");
    fireEvent.keyDown(screen.getByTestId("invite-role"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Viewer" }));

    const targetRow = await findMemberRow(/target@x\.io/);
    await user.click(within(targetRow).getByTestId("member-edit"));
    const roleDialog = await screen.findByRole("dialog");
    const memberRole = within(roleDialog).getByRole("combobox");
    fireEvent.keyDown(memberRole, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Editor" }));

    fireEvent.click(screen.getByTestId("member-sign-in-tracking"));

    expect(await screen.findByText(m.settings_members_err_access_changed())).toBeInTheDocument();
    expect(screen.queryByTestId("invite-preauth")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: m.settings_members_retry() }));

    expect(await screen.findByTestId("invite-preauth")).toHaveValue("draft@example.com");
    expect(screen.getByTestId("invite-role")).toHaveTextContent("Viewer");
    expect(within(await screen.findByRole("dialog")).getByRole("combobox")).toHaveTextContent("Editor");
  });
}

function registerSsoReadinessRefreshTests<T>(
  directory: RawMember[],
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoReadiness: (linked: boolean, reason: string) => T,
): void {
  it("refreshes readiness after a successful membership mutation while retaining the loaded snapshot", async () => {
    const user = userEvent.setup();
    let readinessReads = 0;
    let resolveRefresh: ((response: Response) => void) | undefined;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = mockApi(directory, {
      "GET /sso-readiness": () => {
        readinessReads += 1;
        return readinessReads === 1 ? jsonResponse(ssoReadiness(false, "member_not_linked")) : pendingRefresh;
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection({ providers });

    const targetRow = await findMemberRow(/target@x\.io/);
    await waitFor(() => expect(readinessReads).toBe(1));
    await saveRoleVia(user, targetRow, "Viewer");

    await waitFor(() => expect(readinessReads).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId("sso-readiness")).toBeInTheDocument();
    expect(screen.queryByTestId("sso-readiness-error")).not.toBeInTheDocument();

    await act(async () => {
      requireValue(
        resolveRefresh,
        "the readiness refresh resolver",
      )(jsonResponse({ ...ssoReadiness(false, "member_not_linked"), ready: true, members: [] }));
    });
    expect(await screen.findByText(m.settings_sso_readiness_ready())).toBeInTheDocument();
  });
}

function registerSsoEmailRepairTests(
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoFetch: (linked: boolean, reason: string) => ReturnType<typeof mockApi>,
): void {
  it("corrects a blocking member email through the fresh identity-global route", async () => {
    const user = userEvent.setup();
    const fetchMock = ssoFetch(false, "member_not_linked");
    vi.stubGlobal("fetch", fetchMock);
    renderSection({ providers });

    await user.click(await screen.findByTestId("sso-correct-email"));
    const input = screen.getByTestId("sso-correct-email-input");
    await user.clear(input);
    await user.type(input, "corrected@example.com");
    await user.click(screen.getByTestId("sso-correct-email-save"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members/target/email`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ email: "corrected@example.com" }),
        }),
      ),
    );
  });
}

function registerSsoEmailValidationTests(
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoFetch: (linked: boolean, reason: string) => ReturnType<typeof mockApi>,
): void {
  it("confirms removal of an unverified wrong-subject link before dispatch", async () => {
    const user = userEvent.setup();
    const fetchMock = ssoFetch(true, "unverified_provider_link");
    vi.stubGlobal("fetch", fetchMock);
    renderSection({ providers });

    await user.click(await screen.findByTestId("sso-remove-link"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/target@x\.io.*sign in with their password/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Remove incorrect link" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members/target/federated-link`,
        expect.objectContaining({
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowId: "link-1", providerId: "workforce", subject: "subject-1" }),
        }),
      ),
    );
  });

  it("rejects a malformed repair email beside the field without sending a request", async () => {
    const user = userEvent.setup();
    const fetchMock = ssoFetch(false, "member_not_linked");
    vi.stubGlobal("fetch", fetchMock);
    renderSection({ providers });

    await user.click(await screen.findByTestId("sso-correct-email"));
    const input = screen.getByTestId("sso-correct-email-input");
    await user.clear(input);
    await user.type(input, "not-an-email");
    await user.click(screen.getByTestId("sso-correct-email-save"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.identity_err_email());
    expect(input).toHaveAttribute("aria-describedby", alert.id);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
}

function registerSsoRefusedEmailTest<T>(
  directory: RawMember[],
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoReadiness: (linked: boolean, reason: string) => T,
): void {
  it("shows a refused email correction beside the repair field", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => jsonResponse(ssoReadiness(false, "member_not_linked")),
        "PATCH /members/target/email": () => jsonResponse({ error: "Email already belongs to another user." }, 409),
      }),
    );
    renderSection({ providers });
    await user.click(await screen.findByTestId("sso-correct-email"));
    const input = screen.getByTestId("sso-correct-email-input");
    await user.clear(input);
    await user.type(input, "corrected@example.com");

    await user.click(screen.getByTestId("sso-correct-email-save"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Email already belongs to another user.");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
  });
}

function registerSsoSelfEmailRepairTests<T extends { members: { principalId: string; email: string }[] }>(
  directory: RawMember[],
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoReadiness: (linked: boolean, reason: string) => T,
): void {
  it("reloads after correcting the current user's email without refreshing the directory", async () => {
    const reload = stubPageReload();
    const selfReadiness = ssoReadiness(false, "member_not_linked");
    const selfMember = requireValue(selfReadiness.members[0], "the current member readiness fixture");
    selfMember.principalId = "me";
    selfMember.email = "me@x.io";
    let memberReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "GET /members": () => {
          memberReads += 1;
          return jsonResponse({ members: [rawMember({ userId: "me", role: "owner", isSelf: true })] });
        },
        "GET /sso-readiness": () => jsonResponse(selfReadiness),
      }),
    );
    renderSection({ providers });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("sso-correct-email"));
    const input = screen.getByTestId("sso-correct-email-input");
    await user.clear(input);
    await user.type(input, "corrected@example.com");

    await user.click(screen.getByTestId("sso-correct-email-save"));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(memberReads).toBe(1);
  });

  it("keeps the repair form open and marks its field after a thrown correction", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => jsonResponse(ssoReadiness(false, "member_not_linked")),
        "PATCH /members/target/email": () => Promise.reject(new Error("offline")),
      }),
    );
    renderSection({ providers });
    await user.click(await screen.findByTestId("sso-correct-email"));
    const input = screen.getByTestId("sso-correct-email-input");
    await user.clear(input);
    await user.type(input, "corrected@example.com");

    await user.click(screen.getByTestId("sso-correct-email-save"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.settings_sso_correct_email_error());
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-describedby", alert.id);
  });
}

function registerSsoLinkRepairTests<T extends { members: { principalId: string; email: string }[] }>(
  directory: RawMember[],
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoReadiness: (linked: boolean, reason: string) => T,
): void {
  it("does not bump readiness when federated unlink is refused", async () => {
    const user = userEvent.setup();
    let readinessReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => {
          readinessReads += 1;
          return jsonResponse(ssoReadiness(true, "unverified_provider_link"));
        },
        "DELETE /members/target/federated-link": () => jsonResponse({ error: "Unlink unavailable." }, 500),
      }),
    );
    renderSection({ providers });
    await user.click(await screen.findByTestId("sso-remove-link"));

    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove incorrect link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unlink unavailable.");
    expect(readinessReads).toBe(1);
  });

  it("reloads after unlinking the current user without bumping readiness", async () => {
    const reload = stubPageReload();
    const selfReadiness = ssoReadiness(true, "unverified_provider_link");
    const selfMember = requireValue(selfReadiness.members[0], "the current member readiness fixture");
    selfMember.principalId = "me";
    selfMember.email = "me@x.io";
    let readinessReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "GET /sso-readiness": () => {
          readinessReads += 1;
          return jsonResponse(selfReadiness);
        },
      }),
    );
    renderSection({ providers });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("sso-remove-link"));

    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove incorrect link" }));

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(readinessReads).toBe(1);
  });
}

function registerSsoLinkFailureTest<T>(
  directory: RawMember[],
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoReadiness: (linked: boolean, reason: string) => T,
): void {
  it("shows the remove-link error when unlink throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => jsonResponse(ssoReadiness(true, "unverified_provider_link")),
        "DELETE /members/target/federated-link": () => Promise.reject(new Error("offline")),
      }),
    );
    renderSection({ providers });
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("sso-remove-link"));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove incorrect link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.settings_sso_remove_link_error());
  });
}

function registerSsoReadinessLifecycleTests<T>(
  directory: RawMember[],
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoReadiness: (linked: boolean, reason: string) => T,
): void {
  registerSsoReplacementEffectTest(directory, providers, ssoReadiness);

  it.each(["resolve", "reject"])("ignores a readiness request that finishes after unmount (%s)", async (outcome) => {
    let resolvePending: ((response: Response) => void) | undefined;
    let rejectPending: ((reason: Error) => void) | undefined;
    const pending = new Promise<Response>((resolve, reject) => {
      resolvePending = resolve;
      rejectPending = reject;
    });
    const settle = (response?: Response) =>
      outcome === "resolve"
        ? requireValue(
            resolvePending,
            "the late readiness resolver",
          )(requireValue(response, "the late readiness response"))
        : requireValue(rejectPending, "the late readiness rejecter")(new Error("late readiness"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockApi(directory, { "GET /sso-readiness": () => pending }));
    const view = renderSection({ providers });
    await screen.findByTestId("members-section");
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/sso-readiness"))).toBe(true),
    );

    view.unmount();
    await act(async () => {
      settle(jsonResponse(ssoReadiness(false, "member_not_linked")));
      await Promise.resolve();
    });

    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/state update|not wrapped in act/i);
  });
}

function registerSsoReplacementEffectTest<T>(
  directory: RawMember[],
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoReadiness: (linked: boolean, reason: string) => T,
): void {
  it("ignores an obsolete readiness completion after a provider change starts its replacement", async () => {
    const replacementProvider: NonNullable<AuthContextValue["providers"]>[number] = {
      id: "partner",
      label: "Partner SSO",
      kind: "oidc",
      experimental: false,
    };
    let resolveObsolete: ((response: Response) => void) | undefined;
    let resolveReplacement: ((response: Response) => void) | undefined;
    const obsolete = new Promise<Response>((resolve) => {
      resolveObsolete = resolve;
    });
    const replacement = new Promise<Response>((resolve) => {
      resolveReplacement = resolve;
    });
    let readinessReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => {
          readinessReads += 1;
          return readinessReads === 1 ? obsolete : replacement;
        },
      }),
    );
    const view = renderSection({ providers });
    await waitFor(() => expect(readinessReads).toBe(1));

    view.rerender(
      <AuthContext.Provider value={authValue({ providers: [replacementProvider] })}>
        <MembersSection />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(readinessReads).toBe(2));
    await act(async () => {
      requireValue(
        resolveReplacement,
        "the replacement readiness resolver",
      )(jsonResponse({ ...ssoReadiness(false, "member_not_linked"), provider: replacementProvider }));
    });
    expect(await screen.findByText(/Partner SSO/)).toBeInTheDocument();

    await act(async () => {
      requireValue(
        resolveObsolete,
        "the obsolete readiness resolver",
      )(jsonResponse(ssoReadiness(false, "member_not_linked")));
    });
    expect(screen.getByText(/Partner SSO/)).toBeInTheDocument();
    expect(screen.queryByText(/Workforce SSO/)).not.toBeInTheDocument();
  });
}

function registerSsoReadinessFailureTests<
  T extends { members: { principalId: unknown; repairLinks: { subject: string }[] }[] },
>(
  directory: RawMember[],
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoReadiness: (linked: boolean, reason: string) => T,
): void {
  it("surfaces a readiness fetch failure instead of hiding the cutover state", async () => {
    vi.stubGlobal("fetch", mockApi(directory, { "GET /sso-readiness": () => jsonResponse({}, 503) }));
    renderSection({ providers });

    expect(await screen.findByTestId("sso-readiness-error")).toHaveTextContent(m.settings_sso_readiness_error());
    expect(screen.queryByTestId("sso-readiness")).not.toBeInTheDocument();
  });

  it("retries an errored readiness read after a successful membership mutation", async () => {
    const user = userEvent.setup();
    let readinessReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => {
          readinessReads += 1;
          return readinessReads === 1
            ? jsonResponse({}, 503)
            : jsonResponse({ ...ssoReadiness(false, "member_not_linked"), ready: true, members: [] });
        },
      }),
    );
    renderSection({ providers });
    expect(await screen.findByTestId("sso-readiness-error")).toBeInTheDocument();

    await saveRoleVia(user, await findMemberRow(/target@x\.io/), "Viewer");

    expect(await screen.findByText(m.settings_sso_readiness_ready())).toBeInTheDocument();
    expect(screen.queryByTestId("sso-readiness-error")).not.toBeInTheDocument();
    expect(readinessReads).toBe(2);
  });

  it("rejects malformed nested readiness coordinates", async () => {
    const malformed = ssoReadiness(true, "unverified_provider_link");
    const member = requireValue(malformed.members[0], "the malformed readiness member fixture");
    requireValue(member.repairLinks[0], "the malformed readiness repair fixture").subject = "";
    vi.stubGlobal("fetch", mockApi(directory, { "GET /sso-readiness": () => jsonResponse(malformed) }));
    renderSection({ providers });

    expect(await screen.findByTestId("sso-readiness-error")).toHaveTextContent(m.settings_sso_readiness_error());
  });
}

function registerSsoModeTests(
  providers: NonNullable<AuthContextValue["providers"]>,
  ssoFetch: (linked: boolean, reason: string) => ReturnType<typeof mockApi>,
): void {
  it("does not offer mixed-mode email or link repair after password sign-in is disabled", async () => {
    vi.stubGlobal("fetch", ssoFetch(true, "unverified_provider_link"));
    renderSection({ authMode: "sso", providers });

    expect(await screen.findByTestId("sso-readiness")).toBeInTheDocument();
    expect(screen.queryByTestId("sso-correct-email")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sso-remove-link")).not.toBeInTheDocument();
  });
}

// Reference DEFAULT_ACCOUNT_ID so the fixture import is used (the URL the component builds).
it("uses the active account id from the store in fetch URLs", async () => {
  const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }]);
  vi.stubGlobal("fetch", fetchMock);
  renderSection();
  await screen.findByTestId("members-section");
  expect(fetchMock).toHaveBeenCalledWith(
    `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members`,
    expect.objectContaining({ credentials: "include" }),
  );
});
