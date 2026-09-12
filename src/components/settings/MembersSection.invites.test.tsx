import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { refreshActiveAccountSlice } from "../../data/persist";
import { setOfflineReadState } from "../../data/offlineCache";
import { m } from "@/i18n";
import {
  chooseMemberAction,
  expectNotice,
  findMemberRow,
  mockApi,
  ownerAndEditor,
  rawMember,
  renderSection,
  requireValue,
  saveRoleVia,
  type RawMember,
} from "./MembersSection.testSupport";

interface InviteFailureCaseInput {
  status: number;
  body: { error: string };
  expected: RegExp;
  fieldError: boolean;
}

interface InviteReconciliationCaseInput {
  status: number;
  body: { error: string };
  expected: RegExp;
  reconciles: boolean;
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

describe("MembersSection — invite mint", () => {
  registerInviteCopyControlTests();
  registerInviteMintTests();
  registerInviteAccountTransitionTests();
  registerInviteClipboardTransitionTests();
  registerInviteDeadlineTests();
  registerInviteReloadTests();
  registerInviteMutationTransitionTests();
  registerInviteReconciliationTests();
  registerInviteValidationTests();
  registerInviteCreationFailureTests();
  registerInviteRevokeFailureTests();
  registerInviteLinkReconciliationTests();
  registerInviteMissingLinkReconciliationTests();
  registerInviteClipboardFailureTests();
});

function registerInviteCopyControlTests(): void {
  it("distinguishes reset-link and invitation-link copy controls when both are visible", async () => {
    const user = userEvent.setup();
    const members: RawMember[] = [
      { userId: "me", role: "owner", isSelf: true },
      { userId: "editor", role: "editor", mayResetPassword: true },
    ];
    const fetchMock = mockApi(members, {
      "POST /members/editor/reset-password": () =>
        jsonResponse({ token: "reset/part?x#y", expiresAt: "2026-12-01T12:00:00.000Z" }, 201),
      "POST /api/invites": () => jsonResponse({ token: "invite/part?x#y" }, 201),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();

    const editorRow = await findMemberRow(/editor@x\.io/);
    await chooseMemberAction(user, editorRow, "member-reset-password");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Reset password",
      }),
    );
    expect(await screen.findByTestId("reset-link")).toHaveTextContent("/reset-password/reset%2Fpart%3Fx%23y");

    await user.click(screen.getByTestId("invite-submit"));
    expect(await screen.findByTestId("invite-link")).toHaveTextContent("/invite/invite%2Fpart%3Fx%23y");

    expect(screen.getByRole("button", { name: "Copy reset link for editor@x.io" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy invitation link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();

    await chooseMemberAction(user, editorRow, "member-remove");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(() => expect(screen.queryByTestId("reset-link")).not.toBeInTheDocument());
    expect(screen.getByTestId("invite-link")).toBeInTheDocument();
  });

  it("shows the selected invite role consequences before creating the link", async () => {
    vi.stubGlobal("fetch", mockApi([{ userId: "me", role: "owner", isSelf: true }]));
    renderSection();
    await screen.findByTestId("members-section");

    expect(screen.getByTestId("invite-role-summary")).toHaveTextContent(/Can edit scheduling data/);
    fireEvent.keyDown(screen.getByTestId("invite-role"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Viewer" }));
    expect(screen.getByTestId("invite-role-summary")).toHaveTextContent(/Read-only schedule access/);
  });
}

function registerInviteMintTests(): void {
  it("shows the invite link ONCE on a 201, built from the returned token", async () => {
    const user = userEvent.setup();
    // Creating an invite fires a fire-and-forget reloadInvites() right after, whose result feeds
    // reconcileMintedInvite. The POST must return an `id` (as a real server does) so that reconcile
    // ties the write-once link to it and the reload below is what proves the link survives — a
    // response missing `id` would leave mintedLink.inviteId null, and the null-guard in
    // reconcileMintedInvite would keep the link regardless of whether reconciliation itself works.
    let invites: Record<string, unknown>[] = [];
    let invitesReads = 0;
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "GET /invites": () => {
        invitesReads += 1;
        return jsonResponse({ invites });
      },
      "POST /api/invites": () => {
        invites = [
          {
            id: "inv-new",
            role: "editor",
            preauthEmail: null,
            expiresAt: "2026-12-01T00:00:00.000Z",
            usedAt: null,
            createdAt: "2026-07-17T00:00:00.000Z",
          },
        ];
        return jsonResponse({ id: "inv-new", token: "TOK123", role: "editor" }, 201);
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await screen.findByTestId("members-section");

    await user.click(screen.getByTestId("invite-submit"));
    const link = await screen.findByTestId("invite-link");
    expect(link).toHaveTextContent("/invite/TOK123");
    expect(useStore.getState().notice).toBeNull();

    // The post-create reload confirms the invite is still pending, so the write-once link must
    // survive it — this is the reconciliation path the test's name actually promises.
    await waitFor(() => expect(invitesReads).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId("invite-link")).toHaveTextContent("/invite/TOK123");
  });
}

function registerInviteAccountTransitionTests(): void {
  it("discards account-local bearer links and controls immediately when the account changes", async () => {
    const nextAccountId = "acc_second";
    let minted: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url);
      const isRead = !init || init.method === undefined || init.method === "GET";
      if (target.endsWith(`/${DEFAULT_ACCOUNT_ID}/members`) && isRead) {
        return jsonResponse({ members: [rawMember({ userId: "me", role: "owner", isSelf: true })] });
      }
      if (target.endsWith(`/${nextAccountId}/members`) && isRead) {
        return await new Promise<Response>(() => {});
      }
      if (target.endsWith("/invites") && isRead) {
        // The authoritative list AFTER the create below returns the invite it minted, as a server
        // does: an empty list would mean "that invite is already gone", which is a different test.
        return jsonResponse({ invites: minted });
      }
      if (target.endsWith("/api/invites") && init?.method === "POST") {
        minted = [
          {
            id: "inv-new",
            role: "editor",
            preauthEmail: null,
            expiresAt: "2026-12-01T00:00:00.000Z",
            usedAt: null,
            createdAt: "2026-07-17T00:00:00.000Z",
          },
        ];
        return jsonResponse({ id: "inv-new", token: "ACCOUNT_A_TOKEN" }, 201);
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await screen.findByTestId("members-section");

    fireEvent.click(screen.getByTestId("invite-submit"));
    expect(await screen.findByTestId("invite-link")).toHaveTextContent("/invite/ACCOUNT_A_TOKEN");

    act(() => useStore.setState({ activeAccountId: nextAccountId }));
    expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invite-submit")).not.toBeInTheDocument();
  });
}

function registerInviteClipboardTransitionTests(): void {
  it("does not publish a late clipboard result into a different account", async () => {
    const nextAccountId = "acc_second";
    let finishCopy: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
    );
    vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
      writeText,
    } as unknown as Clipboard);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url);
      const isRead = !init || init.method === undefined || init.method === "GET";
      if (target.endsWith("/members") && isRead) {
        const second = target.includes(`/${nextAccountId}/`);
        return jsonResponse({
          members: [
            second
              ? rawMember({ userId: "second-owner", role: "owner", email: "second@example.test", isSelf: true })
              : rawMember({ userId: "me", role: "owner", isSelf: true }),
          ],
        });
      }
      if (target.endsWith("/invites") && isRead) {
        return jsonResponse({ invites: [] });
      }
      if (target.endsWith("/api/invites") && init?.method === "POST") {
        // Omit the optional id so the write-once link remains visible while this test isolates
        // the clipboard completion race rather than authoritative invite-list reconciliation.
        return jsonResponse({ token: "ACCOUNT_A_TOKEN" }, 201);
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await screen.findByTestId("members-section");

    fireEvent.click(screen.getByTestId("invite-submit"));
    expect(await screen.findByTestId("invite-link")).toBeInTheDocument();
    act(() => useStore.getState().setNotice(null));
    fireEvent.click(screen.getByRole("button", { name: "Copy invitation link" }));
    expect(writeText).toHaveBeenCalledOnce();

    act(() => useStore.setState({ activeAccountId: nextAccountId }));
    expect(await screen.findByText("second@example.test")).toBeInTheDocument();
    await act(async () => finishCopy?.());

    expect(useStore.getState().notice?.message ?? "").not.toMatch(/copied/i);
  });
}

function registerInviteDeadlineTests(): void {
  it("renders outstanding invite expiry on the viewer local calendar date", async () => {
    const expiresAt = "2026-12-01T00:00:00.000Z";
    const localDate = vi.spyOn(Date.prototype, "toLocaleDateString").mockReturnValue("LOCAL INVITE DATE");
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "GET /invites": () =>
        jsonResponse({
          invites: [
            {
              id: "inv-existing",
              role: "viewer",
              preauthEmail: "existing@example.test",
              expiresAt,
              usedAt: null,
              createdAt: "2026-07-17T00:00:00.000Z",
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();

    expect(await screen.findByText(/expires LOCAL INVITE DATE/)).toBeInTheDocument();
    expect(localDate).toHaveBeenCalledOnce();
    expect((localDate.mock.contexts[0] as Date).toISOString()).toBe(expiresAt);
  });

  it("marks an invitation expired and removes its action without remounting Settings", async () => {
    const expiryDelay = 60_000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const expiresAt = new Date(Date.now() + expiryDelay).toISOString();
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "GET /invites": () =>
        jsonResponse({
          invites: [
            {
              id: "inv-expiring",
              role: "viewer",
              preauthEmail: "expiring@example.test",
              expiresAt,
              usedAt: null,
              createdAt: "2026-07-17T00:00:00.000Z",
            },
          ],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSection();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("invite-revoke")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(expiryDelay + 1);
    });
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(screen.queryByTestId("invite-revoke")).not.toBeInTheDocument();
  });
}

function registerInviteReloadTests(): void {
  it("keeps the last authoritative invite list when a same-account invite reload fails", async () => {
    const existingInvite = {
      id: "inv-existing",
      role: "viewer",
      preauthEmail: "existing@example.test",
      expiresAt: "2026-12-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-07-17T00:00:00.000Z",
    };
    let invitationReads = 0;
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "GET /invites": () => {
        invitationReads += 1;
        return invitationReads === 1
          ? jsonResponse({ invites: [existingInvite] })
          : jsonResponse({ error: "Invite reload failed." }, 503);
      },
      "POST /api/invites": () => jsonResponse({ id: "inv-new", token: "TOK123" }, 201),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    expect(await screen.findByText(/existing@example\.test/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invite reload failed.");
    expect(screen.getByText(/existing@example\.test/)).toBeInTheDocument();
  });
}

function registerInviteMutationTransitionTests(): void {
  it("ignores a late unknown mutation outcome after the user has switched accounts", async () => {
    const nextAccountId = "acc_second";
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url);
      const isRead = !init || init.method === undefined || init.method === "GET";
      if (target.endsWith("/members") && isRead) {
        const second = target.includes(`/${nextAccountId}/`);
        return jsonResponse({
          members: [
            second
              ? rawMember({ userId: "second-owner", role: "owner", email: "second@example.test", isSelf: true })
              : rawMember({ userId: "me", role: "owner", isSelf: true }),
          ],
        });
      }
      if (target.endsWith("/invites") && isRead) {
        return jsonResponse({ invites: [] });
      }
      if (target.endsWith("/api/invites") && init?.method === "POST") {
        return await new Promise<Response>((resolve) => {
          resolveCreate = resolve;
        });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await screen.findByTestId("members-section");

    fireEvent.click(screen.getByTestId("invite-submit"));
    await waitFor(() => expect(resolveCreate).toBeTypeOf("function"));
    act(() => useStore.setState({ activeAccountId: nextAccountId }));
    expect(await screen.findByText("second@example.test")).toBeInTheDocument();

    await act(async () => {
      resolveCreate?.(jsonResponse({ error: "The first account outcome is unknown." }, 503));
    });

    expect(screen.getByText("second@example.test")).toBeInTheDocument();
    expect(screen.queryByText(/first account outcome is unknown/i)).not.toBeInTheDocument();
    expect(useStore.getState().notice?.message ?? "").not.toMatch(/unknown outcome/i);
  });
}

function registerInviteReconciliationTests(): void {
  it("removes the write-once link when its invite is revoked", async () => {
    const user = userEvent.setup();
    const invite = {
      id: "inv-new",
      role: "editor",
      preauthEmail: null,
      expiresAt: "2026-12-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-07-17T00:00:00.000Z",
    };
    let invites: (typeof invite)[] = [];
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "POST /api/invites": () => {
        invites = [invite];
        return jsonResponse({ id: invite.id, token: "TOK123", role: invite.role }, 201);
      },
      [`DELETE /invites/${invite.id}`]: () => {
        invites = [];
        return new Response(null, { status: 204 });
      },
      "GET /invites": () => jsonResponse({ invites }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await screen.findByTestId("members-section");

    await user.click(screen.getByTestId("invite-submit"));
    expect(await screen.findByTestId("invite-link")).toHaveTextContent("/invite/TOK123");
    await user.click(await screen.findByTestId("invite-revoke"));

    await waitFor(() => expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument());
  });
}

function registerInviteValidationTests(): void {
  it("refuses a malformed token response instead of constructing an undefined link", async () => {
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }], {
      "POST /api/invites": () => jsonResponse({ role: "editor" }, 201),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await screen.findByTestId("members-section");

    fireEvent.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/one-time link was lost|unknown invite/i);
    expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument();
  });

  it("requires a preauthorised email for an SSO-only invite without posting", async () => {
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }]);
    vi.stubGlobal("fetch", fetchMock);
    renderSection({ authMode: "sso" });

    await userEvent.setup().click(await screen.findByTestId("invite-submit"));

    const field = screen.getByTestId("invite-preauth");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.settings_sso_invite_email_required());
    expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
}

function registerInviteCreationFailureTests(): void {
  it.each([
    { status: 503, body: { error: "Invite uncertain." }, expected: /unknown outcome.*reloaded/i, fieldError: false },
    { status: 403, body: { error: "Invite forbidden." }, expected: /Invite forbidden\./, fieldError: true },
  ])(
    "handles a $status invite-create response on the current account",
    async ({ status, body, expected, fieldError }: InviteFailureCaseInput) => {
      vi.stubGlobal(
        "fetch",
        mockApi(ownerAndEditor, {
          "POST /api/invites": () => jsonResponse(body, status),
        }),
      );
      renderSection();

      await userEvent.setup().click(await screen.findByTestId("invite-submit"));

      const alert = fieldError ? await screen.findByRole("alert") : null;
      if (fieldError) expect(alert).toHaveTextContent(expected);
      else await expectNotice(expected);
      expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument();
      if (fieldError) {
        if (alert === null) throw new Error("Expected the invitation field error");
        expect(screen.getByTestId("invite-preauth").getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
      }
    },
  );

  it("reconciles a thrown invite creation without minting a link", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "POST /api/invites": () => Promise.reject(new Error("invite transport lost")),
      }),
    );
    renderSection();

    await userEvent.setup().click(await screen.findByTestId("invite-submit"));

    await expectNotice(/unknown outcome.*invite transport lost.*reloaded/i);
    expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument();
  });
}

function registerInviteRevokeFailureTests(): void {
  it.each([
    { status: 503, body: { error: "Revoke uncertain." }, expected: /unknown outcome.*reloaded/i, reconciles: true },
    { status: 403, body: { error: "Revoke forbidden." }, expected: /Revoke forbidden\./, reconciles: false },
  ])(
    "handles a $status invite-revoke response without dropping the row",
    async ({ status, body, expected, reconciles }: InviteReconciliationCaseInput) => {
      let inviteReads = 0;
      const invite = {
        id: "inv-existing",
        role: "editor",
        preauthEmail: "existing@example.test",
        expiresAt: "2026-12-01T00:00:00.000Z",
        usedAt: null,
        createdAt: "2026-07-17T00:00:00.000Z",
      };
      vi.stubGlobal(
        "fetch",
        mockApi([{ userId: "me", role: "owner", isSelf: true }], {
          "GET /invites": () => {
            inviteReads += 1;
            return jsonResponse({ invites: [invite] });
          },
          "DELETE /invites/inv-existing": () => jsonResponse(body, status),
        }),
      );
      renderSection();

      await userEvent.setup().click(await screen.findByTestId("invite-revoke"));

      if (reconciles) await expectNotice(expected);
      else expect(await screen.findByRole("alert")).toHaveTextContent(expected);
      expect(screen.getByText(/existing@example\.test/)).toBeInTheDocument();
      expect(inviteReads).toBe(reconciles ? 2 : 1);
    },
  );

  it("warns and rereads invitations after a thrown revoke", async () => {
    let inviteReads = 0;
    const invite = {
      id: "inv-existing",
      role: "editor",
      preauthEmail: "existing@example.test",
      expiresAt: "2026-12-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-07-17T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "GET /invites": () => {
          inviteReads += 1;
          return jsonResponse({ invites: [invite] });
        },
        "DELETE /invites/inv-existing": () => Promise.reject(new Error("revoke transport lost")),
      }),
    );
    renderSection();

    await userEvent.setup().click(await screen.findByTestId("invite-revoke"));

    await expectNotice(/unknown outcome.*revoke transport lost.*reloaded/i);
    expect(inviteReads).toBe(2);
  });
}

function registerInviteLinkReconciliationTests(): void {
  it("keeps invite A's minted link when invite B is revoked", async () => {
    const inviteA = {
      id: "invite-a",
      role: "editor",
      preauthEmail: null,
      expiresAt: "2026-12-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-07-17T00:00:00.000Z",
    };
    const inviteB = { ...inviteA, id: "invite-b", preauthEmail: "b@example.test" };
    let invites: Record<string, unknown>[] = [inviteB];
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "GET /invites": () => jsonResponse({ invites }),
        "POST /api/invites": () => {
          invites = [inviteA, inviteB];
          return jsonResponse({ id: inviteA.id, token: "TOKEN_A" }, 201);
        },
        "DELETE /invites/invite-b": () => {
          invites = [inviteA];
          return new Response(null, { status: 204 });
        },
      }),
    );
    renderSection();
    await screen.findByText(/b@example\.test/);

    await userEvent.setup().click(screen.getByTestId("invite-submit"));
    expect(await screen.findByTestId("invite-link")).toHaveTextContent("/invite/TOKEN_A");
    const revokeButtons = await screen.findAllByTestId("invite-revoke");
    await userEvent.setup().click(requireValue(revokeButtons[1], "the second invitation revoke button"));

    await waitFor(() => expect(screen.queryByText(/b@example\.test/)).not.toBeInTheDocument());
    expect(screen.getByTestId("invite-link")).toHaveTextContent("/invite/TOKEN_A");
  });
}

function registerInviteMissingLinkReconciliationTests(): void {
  it("removes a minted link when an unknown-outcome authoritative list omits it", async () => {
    const minted = {
      id: "invite-a",
      role: "editor",
      preauthEmail: null,
      expiresAt: "2026-12-01T00:00:00.000Z",
      usedAt: null,
      createdAt: "2026-07-17T00:00:00.000Z",
    };
    let created = false;
    let inviteReadsAfterCreate = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        "GET /invites": () => {
          if (!created) return jsonResponse({ invites: [] });
          inviteReadsAfterCreate += 1;
          return jsonResponse({ invites: inviteReadsAfterCreate === 1 ? [minted] : [] });
        },
        "POST /api/invites": () => {
          created = true;
          return jsonResponse({ id: minted.id, token: "TOKEN_A" }, 201);
        },
        "PATCH /members/ed": () => jsonResponse({}, 503),
      }),
    );
    renderSection();
    await userEvent.setup().click(await screen.findByTestId("invite-submit"));
    expect(await screen.findByTestId("invite-link")).toBeInTheDocument();

    await saveRoleVia(userEvent.setup(), await findMemberRow(/ed@x\.io/), "Viewer");

    await waitFor(() => expect(screen.queryByTestId("invite-link")).not.toBeInTheDocument());
  });
}

function registerInviteClipboardFailureTests(): void {
  it.each(["missing", "rejected"])("reports copy failure when clipboard is %s", async (kind) => {
    const user = userEvent.setup();
    if (kind === "missing") {
      vi.spyOn(navigator, "clipboard", "get").mockReturnValue(undefined as unknown as Clipboard);
    } else {
      vi.spyOn(navigator, "clipboard", "get").mockReturnValue({
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      } as unknown as Clipboard);
    }
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "POST /api/invites": () => jsonResponse({ token: "TOKEN" }, 201),
      }),
    );
    renderSection();
    await user.click(await screen.findByTestId("invite-submit"));

    await user.click(await screen.findByRole("button", { name: "Copy invitation link" }));

    await waitFor(() =>
      expect(useStore.getState().notice).toMatchObject({ message: m.settings_members_copy_failed(), tone: "error" }),
    );
  });
}
