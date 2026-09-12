import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { resetStoreWithAccount, jsonResponse } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { refreshActiveAccountSlice } from "../../data/persist";
import { setOfflineReadState } from "../../data/offlineCache";
import { m } from "@/i18n";
import {
  confirmMemberAction,
  expectNotice,
  findMemberRow,
  mockApi,
  ownerAndEditor,
  rawMember,
  renderSection,
  saveRoleVia,
  stubPageReload,
} from "./MembersSection.testSupport";

interface RoleFailureCaseInput {
  status: number;
  body: { error: string };
  expected: RegExp;
  reconciles: boolean;
}

interface MemberRemovalFailureCaseInput {
  status: number;
  body: { error: string };
  expected: RegExp;
  reconciles: boolean;
}

interface MemberReloadCaseInput {
  status: number;
  self: boolean;
  reloads: boolean;
  expected: RegExp | null;
}

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

describe("MembersSection — mutation failure reconciliation", () => {
  registerSelfMutationFailureTests();
  registerAccountSwitchMutationTests();
  registerLateReconciliationTests();
  registerThrownMutationTests();
  registerRoleFailureTests();
  registerRemovalFailureTests();
  registerStatusFailureTests();
});

function registerSelfMutationFailureTests(): void {
  it("closes the company when a successful self-role change cannot refresh account access", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, { "GET /api/accounts": () => jsonResponse({ error: "Unavailable." }, 500) }),
    );
    renderSection();

    await saveRoleVia(userEvent.setup(), await findMemberRow(/me@x\.io/), "Editor");

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
    expect(useStore.getState().notice).toMatchObject({
      message: m.settings_members_access_refresh_failed(),
      tone: "error",
    });
  });

  it("closes the company silently after a successful self-removal", async () => {
    vi.stubGlobal("fetch", mockApi(ownerAndEditor));
    renderSection();

    await confirmMemberAction({
      user: userEvent.setup(),
      row: await findMemberRow(/me@x\.io/),
      testId: "member-remove",
      confirmationName: "Remove",
    });

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
    expect(useStore.getState().notice).toBeNull();
  });
}

function registerAccountSwitchMutationTests(): void {
  it("reports an authoritative reload failure after an unknown non-self mutation", async () => {
    let mutationSent = false;
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        "PATCH /members/ed": () => {
          mutationSent = true;
          return jsonResponse({ error: "Unknown." }, 503);
        },
        "GET /members": () =>
          mutationSent
            ? jsonResponse({ error: "Reload failed." }, 500)
            : jsonResponse({ members: ownerAndEditor.map((member) => rawMember(member)) }),
      }),
    );
    renderSection();

    await saveRoleVia(userEvent.setup(), await findMemberRow(/ed@x\.io/), "Viewer");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Reload the page before retrying/i);
    expect(alert).not.toHaveTextContent(/company access was refreshed/i);
  });

  it("does not publish a role result after the active account switches mid-request", async () => {
    const nextAccountId = "acc_second";
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        "PATCH /members/ed": () => {
          useStore.setState({ activeAccountId: nextAccountId });
          return new Response(null, { status: 204 });
        },
      }),
    );
    renderSection();

    await saveRoleVia(userEvent.setup(), await findMemberRow(/ed@x\.io/), "Viewer");

    await waitFor(() => expect(useStore.getState().activeAccountId).toBe(nextAccountId));
    expect(useStore.getState().notice).toBeNull();
  });
}

function registerLateReconciliationTests(): void {
  it("does not publish an unknown reconcile whose member reread switches accounts", async () => {
    const nextAccountId = "acc_second";
    let mutationSent = false;
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        "PATCH /members/ed": () => {
          mutationSent = true;
          return jsonResponse({}, 503);
        },
        "GET /members": () => {
          if (mutationSent) useStore.setState({ activeAccountId: nextAccountId });
          return jsonResponse({ members: ownerAndEditor.map((member) => rawMember(member)) });
        },
      }),
    );
    renderSection();

    await saveRoleVia(userEvent.setup(), await findMemberRow(/ed@x\.io/), "Viewer");

    await waitFor(() => expect(useStore.getState().activeAccountId).toBe(nextAccountId));
    expect(useStore.getState().notice).toBeNull();
  });

  it("leaves the newly selected company open when the account switches during self-refresh", async () => {
    const nextAccountId = "acc_second";
    const refreshAuth = vi.fn(async () => {
      useStore.setState({ activeAccountId: nextAccountId });
    });
    vi.stubGlobal("fetch", mockApi(ownerAndEditor));
    renderSection({ refreshAuth });

    await saveRoleVia(userEvent.setup(), await findMemberRow(/me@x\.io/), "Editor");

    await waitFor(() => expect(useStore.getState().activeAccountId).toBe(nextAccountId));
    expect(useStore.getState().notice?.message).toBe(m.settings_members_role_updated());
    expect(useStore.getState().notice?.tone).not.toBe("error");
  });
}

function registerThrownMutationTests(): void {
  it("does not close a newly selected company for a late self-mutation failure", async () => {
    const nextAccountId = "acc_second";
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        "PATCH /members/me": () => new Promise<Response>((resolve) => (finish = resolve)),
      }),
    );
    renderSection();
    const roleChange = saveRoleVia(userEvent.setup(), await findMemberRow(/me@x\.io/), "Editor");
    await waitFor(() => expect(finish).toBeTypeOf("function"));

    act(() => useStore.setState({ activeAccountId: nextAccountId }));
    await act(async () => finish(jsonResponse({ error: "Forbidden." }, 403)));

    await roleChange;

    expect(useStore.getState().activeAccountId).toBe(nextAccountId);
    expect(useStore.getState().notice).toBeNull();
  });

  it.each([
    ["rejected", () => jsonResponse({ error: "Tracking forbidden." }, 403), /Tracking forbidden\./],
    ["transport", () => Promise.reject(new Error("tracking offline")), /Could not reach the server.*tracking offline/i],
  ])("reloads the directory after a %s sign-in-tracking failure", async (_kind, response, expected) => {
    let memberReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(
        [
          { userId: "me", role: "owner", isSelf: true, signInConfirmed: true },
          { userId: "ed", role: "editor", signInConfirmed: false },
        ],
        {
          "GET /members": () => {
            memberReads += 1;
            return jsonResponse({
              signInTrackingEnabled: false,
              members: [
                rawMember({ userId: "me", role: "owner", isSelf: true, signInConfirmed: false }),
                rawMember({ userId: "ed", role: "editor", signInConfirmed: false }),
              ],
            });
          },
          "PUT /member-sign-in-tracking": response,
        },
      ),
    );
    renderSection();

    await userEvent.setup().click(await screen.findByTestId("member-sign-in-tracking"));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    await waitFor(() => expect(memberReads).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId("member-sign-in-tracking")).not.toBeChecked();
  });
}

function registerRoleFailureTests(): void {
  it.each([
    { status: 503, body: { error: "Uncertain." }, expected: /unknown outcome/i, reconciles: true },
    { status: 403, body: { error: "Role forbidden." }, expected: /Role forbidden\./, reconciles: false },
  ])(
    "handles a $status role-change response without claiming success",
    async ({ status, body, expected, reconciles }: RoleFailureCaseInput) => {
      let memberReads = 0;
      vi.stubGlobal(
        "fetch",
        mockApi(ownerAndEditor, {
          "GET /members": () => {
            memberReads += 1;
            return jsonResponse({ members: ownerAndEditor.map((member) => rawMember(member)) });
          },
          "PATCH /members/ed": () => jsonResponse(body, status),
        }),
      );
      renderSection();

      await saveRoleVia(userEvent.setup(), await findMemberRow(/ed@x\.io/), "Viewer");

      if (reconciles) await expectNotice(expected);
      else expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(useStore.getState().notice?.message).not.toBe(m.settings_members_role_updated());
      expect(memberReads).toBe(reconciles ? 2 : 1);
    },
  );
}

function registerRemovalFailureTests(): void {
  it.each([
    { status: 503, body: { error: "Uncertain." }, expected: /unknown outcome/i, reconciles: true },
    {
      status: 403,
      body: { error: "Last owner cannot be removed." },
      expected: /Last owner cannot be removed\./,
      reconciles: false,
    },
  ])(
    "handles a $status member-removal response without removing the row",
    async ({ status, body, expected, reconciles }: MemberRemovalFailureCaseInput) => {
      let memberReads = 0;
      vi.stubGlobal(
        "fetch",
        mockApi(ownerAndEditor, {
          "GET /members": () => {
            memberReads += 1;
            return jsonResponse({ members: ownerAndEditor.map((member) => rawMember(member)) });
          },
          "DELETE /members/ed": () => jsonResponse(body, status),
        }),
      );
      renderSection();

      await confirmMemberAction({
        user: userEvent.setup(),
        row: await findMemberRow(/ed@x\.io/),
        testId: "member-remove",
        confirmationName: "Remove",
      });

      if (reconciles) await expectNotice(expected);
      else expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(screen.getByText(/ed@x\.io/)).toBeInTheDocument();
      expect(memberReads).toBe(reconciles ? 2 : 1);
    },
  );
}

function registerStatusFailureTests(): void {
  it("reconciles a 503 status change without claiming success", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, { "PATCH /members/ed/status": () => jsonResponse({ error: "Uncertain." }, 503) }),
    );
    renderSection();

    await confirmMemberAction({
      user: userEvent.setup(),
      row: await findMemberRow(/ed@x\.io/),
      testId: "member-disable",
      confirmationName: /disable/i,
    });

    await expectNotice(/unknown outcome.*reloaded/i);
    expect(useStore.getState().notice?.message).not.toBe(m.settings_members_status_changed());
  });

  it("includes transport detail when a status change throws", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        "PATCH /members/ed/status": () => Promise.reject(new Error("status connection lost")),
      }),
    );
    renderSection();

    await confirmMemberAction({
      user: userEvent.setup(),
      row: await findMemberRow(/ed@x\.io/),
      testId: "member-disable",
      confirmationName: /disable/i,
    });

    await expectNotice(/unknown outcome.*status connection lost.*reloaded/i);
  });
}

describe("MembersSection — password reset and session failures", () => {
  async function requestReset(): Promise<void> {
    await confirmMemberAction({
      user: userEvent.setup(),
      row: await findMemberRow(/ed@x\.io/),
      testId: "member-reset-password",
      confirmationName: "Reset password",
    });
  }

  registerPasswordResetFailureTests(requestReset);
  registerSessionFailureTests();
});

function registerPasswordResetFailureTests(requestReset: () => Promise<void>): void {
  it.each([
    [503, jsonResponse({ error: "Uncertain." }, 503), /reset-token request had an unknown outcome/i],
    [200, new Response("not-json", { status: 200 }), /one-time value was lost/i],
    [400, jsonResponse({ error: "Password mode is disabled." }, 400), /Password mode is disabled\./],
    [201, jsonResponse({ token: "TOKEN" }, 201), /one-time value was lost/i],
  ])("handles reset response case %s without rendering a link", async (_status, response, expected) => {
    vi.stubGlobal("fetch", mockApi(ownerAndEditor, { "POST /members/ed/reset-password": () => response }));
    renderSection();

    await requestReset();

    if (_status === 400) expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    else await expectNotice(expected);
    expect(screen.queryByTestId("reset-link")).not.toBeInTheDocument();
  });

  it("clears a prior reset link and reports detail when a reset request throws", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        "POST /members/ed/reset-password": () => {
          attempts += 1;
          return attempts === 1
            ? jsonResponse({ token: "TOKEN", expiresAt: "2026-12-01T00:00:00.000Z" }, 201)
            : Promise.reject(new Error("reset transport lost"));
        },
      }),
    );
    renderSection();
    await requestReset();
    expect(await screen.findByTestId("reset-link")).toBeInTheDocument();

    await requestReset();

    await expectNotice(/unknown outcome.*reset transport lost/i);
    expect(screen.queryByTestId("reset-link")).not.toBeInTheDocument();
  });
}

function registerSessionFailureTests(): void {
  it.each([
    { status: 503, self: false, reloads: false, expected: /unknown outcome/i },
    { status: 503, self: true, reloads: true, expected: null },
  ])(
    "handles a 503 session revocation (status=$status, self=$self)",
    async ({ status, self, reloads, expected }: MemberReloadCaseInput) => {
      const reload = stubPageReload();
      vi.stubGlobal(
        "fetch",
        mockApi(ownerAndEditor, {
          [`POST /members/${self ? "me" : "ed"}/revoke-sessions`]: () => jsonResponse({}, status),
        }),
      );
      renderSection();
      const row = await findMemberRow(self ? /me@x\.io/ : /ed@x\.io/);

      await confirmMemberAction({
        user: userEvent.setup(),
        row: row,
        testId: "member-revoke-sessions",
        confirmationName: "Revoke sessions",
      });

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(reloads ? 1 : 0));
      if (expected) await expectNotice(expected);
      else expect(useStore.getState().notice).toBeNull();
    },
  );

  it.each([
    [true, true],
    [false, false],
  ])("handles a thrown session revocation (self=%s)", async (self, reloads) => {
    const reload = stubPageReload();
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        [`POST /members/${self ? "me" : "ed"}/revoke-sessions`]: () =>
          Promise.reject(new Error("session transport lost")),
      }),
    );
    renderSection();

    await confirmMemberAction({
      user: userEvent.setup(),
      row: await findMemberRow(self ? /me@x\.io/ : /ed@x\.io/),
      testId: "member-revoke-sessions",
      confirmationName: "Revoke sessions",
    });

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(reloads ? 1 : 0));
    if (!self) await expectNotice(/unknown outcome.*session transport lost/i);
    else expect(useStore.getState().notice).toBeNull();
  });
}
