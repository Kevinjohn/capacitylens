import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { refreshActiveAccountSlice } from "../../data/persist";
import { setOfflineReadState } from "../../data/offlineCache";
import { m } from "@/i18n";
import {
  accessibleMemberNames,
  accessibleNameMembers,
  chooseMemberAction,
  expectAccessibleMemberControls,
  findMemberRow,
  mockApi,
  openMemberMenu,
  renderSection,
  saveRoleVia,
  soleOwnerAndEditor,
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

describe("MembersSection — admin affordances", () => {
  const members: RawMember[] = [
    { userId: "me", role: "admin", isSelf: true },
    { userId: "theowner", role: "owner" },
    { userId: "theeditor", role: "editor" },
  ];

  registerAdminInviteTests(members);
  registerAdminInviteLinkTests(members);
  registerAdminMemberControlTests(members);
  registerAdminConfirmationTests(members);
  registerAdminSessionTests(members);
  registerAdminSelfActionTests();
  registerAdminRoleChangeTests(members);
  registerAdminProjectionTests(members);
});

function registerAdminInviteTests(members: RawMember[]): void {
  it("does NOT offer the owner option in the invite role picker", async () => {
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    await screen.findByTestId("members-section");

    fireEvent.keyDown(screen.getByTestId("invite-role"), { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Editor" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-sign-in-tracking")).not.toBeInTheDocument();
  });

  it("marks and describes an invalid invitation pre-authorisation email", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    const email = await screen.findByTestId("invite-preauth");

    await user.type(email, "not-an-email");
    await user.click(screen.getByTestId("invite-submit"));

    const error = await screen.findByRole("alert");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);
    expect(error).toHaveTextContent(m.identity_err_email());
  });

  it("rejects an invitation pre-authorisation email containing disallowed characters", async () => {
    // Regression: the inline check used to only compare UTF-16 .length against MAX_EMAIL_LENGTH
    // and never screened for disallowed characters, so an emoji/zero-width address that stayed
    // under the length cap slipped past client-side validation. isAccountEmail() rejects it.
    const user = userEvent.setup();
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    const email = await screen.findByTestId("invite-preauth");

    await user.type(email, "a​🙂@example.com");
    await user.click(screen.getByTestId("invite-submit"));

    const error = await screen.findByRole("alert");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(error).toHaveTextContent(m.identity_err_email());
  });
}

function registerAdminInviteLinkTests(members: RawMember[]): void {
  it("keeps an existing write-once invite link when a later submit fails validation", async () => {
    const user = userEvent.setup();
    let created = false;
    const fetchMock = mockApi(members, {
      "POST /api/invites": () => {
        created = true;
        return jsonResponse({ id: "invite-1", token: "WRITE_ONCE_TOKEN", role: "editor" }, 201);
      },
      "GET /invites": () =>
        jsonResponse({
          invites: created
            ? [
                {
                  id: "invite-1",
                  role: "editor",
                  preauthEmail: null,
                  expiresAt: "2026-12-01T00:00:00.000Z",
                  usedAt: null,
                  createdAt: "2026-07-29T00:00:00.000Z",
                },
              ]
            : [],
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();

    await user.click(await screen.findByTestId("invite-submit"));
    const link = await screen.findByTestId("invite-link");
    expect(link).toHaveTextContent("/invite/WRITE_ONCE_TOKEN");

    await user.type(screen.getByTestId("invite-preauth"), "not-an-email");
    await user.click(screen.getByTestId("invite-submit"));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.identity_err_email());
    expect(screen.getByTestId("invite-link")).toHaveTextContent("/invite/WRITE_ONCE_TOKEN");
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith("/api/invites") && (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toHaveLength(1);
  });
}

function registerAdminMemberControlTests(members: RawMember[]): void {
  it("shows no role control + no Remove on an OWNER row (admin can't touch an owner)", async () => {
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    await screen.findByTestId("members-section");

    const ownerRow = await findMemberRow(/theowner@x\.io/);
    expect(ownerRow).toBeTruthy();
    // No pencil on the owner row for an admin, and no gear either: with reset/revoke/status/remove
    // all forbidden against an Owner the menu has nothing left to offer, so it is not rendered.
    expect(within(ownerRow).queryByTestId("member-edit")).not.toBeInTheDocument();
    expect(within(ownerRow).queryByTestId("member-menu")).not.toBeInTheDocument();

    // The editor row, by contrast, IS manageable by the admin.
    const editorRow = await findMemberRow(/theeditor@x\.io/);
    expect(within(editorRow).getByTestId("member-edit")).toBeInTheDocument();
    await chooseMemberAction(userEvent.setup(), editorRow, "member-remove");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("offers masquerade for every other active member, including an owner, and confirms by name", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    const selfRow = await findMemberRow(/me@x\.io/);
    const ownerRow = await findMemberRow(/theowner@x\.io/);
    const editorRow = await findMemberRow(/theeditor@x\.io/);

    expect(within(selfRow).queryByTestId("member-masquerade")).not.toBeInTheDocument();
    expect(within(ownerRow).getByTestId("member-masquerade")).toBeInTheDocument();
    expect(within(editorRow).getByTestId("member-masquerade")).toBeInTheDocument();

    await user.click(within(ownerRow).getByTestId("member-masquerade"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Confirm you would like to masquerade as theowner@x.io");
    await user.click(within(dialog).getByRole("button", { name: "Start masquerade" }));
    expect(accountTransitionMocks.startMasquerade).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID, "theowner");
  });
}

function registerAdminConfirmationTests(members: RawMember[]): void {
  it("names the member and waits for confirmation before sending removal", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(members);
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const editorRow = await findMemberRow(/theeditor@x\.io/);

    await chooseMemberAction(user, editorRow, "member-remove");

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/theeditor@x\.io will immediately lose access/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/members/theeditor"),
      expect.objectContaining({ method: "DELETE" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members/theeditor`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it.each([
    ["member-reset-password", /revoke any existing reset link for theeditor@x\.io/i],
    ["member-revoke-sessions", /sign theeditor@x\.io out of every active/i],
  ])("waits for confirmation before dispatching %s", async (testId, consequence) => {
    const user = userEvent.setup();
    const actionableMembers = members.map((member) =>
      member.userId === "theeditor" ? { ...member, mayResetPassword: true, mayRevokeSessions: true } : member,
    );
    const fetchMock = mockApi(actionableMembers);
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const editorRow = await findMemberRow(/theeditor@x\.io/);

    await chooseMemberAction(user, editorRow, testId);

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(consequence)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  });
}

function registerAdminSessionTests(members: RawMember[]): void {
  it("uses the message catalogue for session revocation controls and success notices", async () => {
    const user = userEvent.setup();
    const actionableMembers = members.map((member) =>
      member.userId === "theeditor" ? { ...member, mayRevokeSessions: true } : member,
    );
    vi.stubGlobal("fetch", mockApi(actionableMembers));
    renderSection();
    const editorRow = await findMemberRow(/theeditor@x\.io/);
    await openMemberMenu(user, editorRow);
    const revokeButton = screen.getByTestId("member-revoke-sessions");

    expect(revokeButton).toHaveTextContent(m.settings_member_revoke_sessions());
    await user.click(revokeButton);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: m.settings_member_revoke_sessions(),
      }),
    );

    await waitFor(() => expect(useStore.getState().notice?.message).toBe(m.settings_members_sessions_revoked()));
  });

  it("uses the message catalogue for the generic session revocation failure", async () => {
    const user = userEvent.setup();
    const actionableMembers = members.map((member) =>
      member.userId === "theeditor" ? { ...member, mayRevokeSessions: true } : member,
    );
    vi.stubGlobal(
      "fetch",
      mockApi(actionableMembers, {
        "POST /members/theeditor/revoke-sessions": () => jsonResponse({}, 400),
      }),
    );
    renderSection();
    const editorRow = await findMemberRow(/theeditor@x\.io/);

    await chooseMemberAction(user, editorRow, "member-revoke-sessions");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: m.settings_member_revoke_sessions(),
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(m.settings_members_err_revoke_sessions({ status: 400 }));
  });
}

function registerAdminSelfActionTests(): void {
  it("spells out access and reload consequences for self-targeted actions", async () => {
    const user = userEvent.setup();
    const selfMembers: RawMember[] = [
      { userId: "me", role: "admin", isSelf: true, mayRevokeSessions: true },
      { userId: "owner", role: "owner" },
    ];
    vi.stubGlobal("fetch", mockApi(selfMembers));
    renderSection();
    const selfRow = await findMemberRow(/me@x\.io/);

    await chooseMemberAction(user, selfRow, "member-remove");
    expect(within(screen.getByRole("alertdialog")).getByText(/return to the company picker/i)).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    await chooseMemberAction(user, selfRow, "member-revoke-sessions");
    expect(within(screen.getByRole("alertdialog")).getByText(/this browser.*reload into sign-in/i)).toBeInTheDocument();
  });
}

function registerAdminRoleChangeTests(members: RawMember[]): void {
  it("explains and confirms a role change before sending it", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(members);
    vi.stubGlobal("fetch", fetchMock);
    const revisionBefore = useStore.getState().membershipRevision;
    renderSection();
    const editorRow = await findMemberRow(/theeditor@x\.io/);

    await user.click(within(editorRow).getByTestId("member-edit"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/theeditor@x\.io/)).toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Viewer" }));
    // The summary explains the consequence, and choosing a role is still only a DRAFT.
    expect(within(dialog).getByTestId("member-role-summary")).toHaveTextContent(/Read-only schedule access/);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/members/theeditor"), expect.anything());

    await user.click(within(dialog).getByTestId("member-role-save"));
    expect(fetchMock).toHaveBeenCalledWith(
      `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members/theeditor`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "viewer" }),
      }),
    );
    expect(useStore.getState().membershipRevision).toBe(revisionBefore);
  });
}

function registerAdminProjectionTests(members: RawMember[]): void {
  it("announces and marks the section busy while a member action is in flight", async () => {
    const user = userEvent.setup();
    let releasePatch!: () => void;
    const patchResponse = new Promise<Response>((resolve) => {
      releasePatch = () => resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", mockApi(members, { "PATCH /members/theeditor": () => patchResponse }));
    renderSection();
    const editorRow = await findMemberRow(/theeditor@x\.io/);

    await saveRoleVia(user, editorRow, "Viewer");

    await waitFor(() => expect(screen.getByTestId("members-section")).toHaveAttribute("aria-busy", "true"));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(m.settings_members_updating());
    expect(status).toHaveFocus();

    releasePatch();
    await waitFor(() => expect(screen.getByTestId("members-section")).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("invalidates membership projections when an Admin changes their own role", async () => {
    const user = userEvent.setup();
    const refreshAuth = vi.fn(async () => {});
    vi.stubGlobal("fetch", mockApi(members));
    const revisionBefore = useStore.getState().membershipRevision;
    renderSection({ refreshAuth });

    const selfRow = await findMemberRow(/me@x\.io/);
    await saveRoleVia(user, selfRow, "Editor");

    await waitFor(() => expect(useStore.getState().membershipRevision).toBe(revisionBefore + 1));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(refreshActiveAccountSlice).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
  });

  it("closes the company when a self-role refresh restores only a cached offline slice", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", mockApi(members));
    vi.mocked(refreshActiveAccountSlice).mockImplementationOnce(async () => {
      setOfflineReadState("tenant", true, Date.parse("2026-07-17T10:00:00.000Z"));
      return { kind: "reloaded" };
    });
    renderSection();

    const selfRow = await findMemberRow(/me@x\.io/);
    await saveRoleVia(user, selfRow, "Editor");

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
    expect(useStore.getState().notice?.message).toMatch(/could not be safely refreshed/i);
  });
}

describe("MembersSection — owner affordances", () => {
  it("gives every member-row control a unique member-scoped accessible name", async () => {
    vi.stubGlobal("fetch", mockApi(accessibleNameMembers));
    renderSection();
    await screen.findByTestId("members-section");

    const user = userEvent.setup();
    const rows = screen.getAllByTestId("member-row");
    for (const [name, member] of accessibleMemberNames) {
      await expectAccessibleMemberControls({ user, rows, name, member });
    }
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("never offers Owner as an ordinary role, even to the Owner", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", mockApi(soleOwnerAndEditor));
    renderSection();
    await screen.findByTestId("members-section");

    fireEvent.keyDown(screen.getByTestId("invite-role"), { key: "ArrowDown" });
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const editorRow = await findMemberRow(/ed@x\.io/);
    await user.click(within(editorRow).getByTestId("member-edit"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("keeps the single Owner outside ordinary role and removal controls", async () => {
    vi.stubGlobal("fetch", mockApi(soleOwnerAndEditor));
    renderSection();
    await screen.findByTestId("members-section");

    const soleOwnerRow = await findMemberRow(/me@x\.io/);
    expect(within(soleOwnerRow).getByTestId("member-role")).toHaveTextContent(m.settings_member_sole_owner_protected());
    // No pencil (the role is not editable) and no gear: nothing in it would be permitted.
    expect(within(soleOwnerRow).queryByTestId("member-edit")).not.toBeInTheDocument();
    expect(within(soleOwnerRow).queryByTestId("member-menu")).not.toBeInTheDocument();
  });
});
