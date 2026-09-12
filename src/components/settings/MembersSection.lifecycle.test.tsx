import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { refreshActiveAccountSlice } from "../../data/persist";
import { setOfflineReadState } from "../../data/offlineCache";
import { m } from "@/i18n";
import {
  chooseMemberAction,
  findMemberRow,
  makeSignInTrackingApi,
  mockApi,
  openInactiveGroup,
  openMemberMenu,
  rawMember,
  renderSection,
  requireCallback,
  requireValue,
  saveRoleVia,
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

describe("MembersSection — member lifecycle", () => {
  // Transfer ownership is deliberately NOT here: #175 removed the per-member button, and the
  // action returns under a follow-up ticket as its own owner-only section. Its server route and
  // client method are untouched, so this describe covers what the ROW can now do instead.
  const lifecycleMembers: RawMember[] = [
    { userId: "me", role: "owner", isSelf: true },
    { userId: "ed", role: "editor" },
  ];

  registerLifecycleStatusTests(lifecycleMembers);
  registerLifecycleVisibilityTests();
  registerLifecycleDisclosureTests();
  registerLifecyclePermissionTests(lifecycleMembers);
  registerLifecycleTrackingTests();
  registerLifecycleReconciliationTests();
  registerLifecycleConcurrencyTests();
});

function registerLifecycleStatusTests(lifecycleMembers: RawMember[]): void {
  it("never offers a transfer-ownership control on any row", async () => {
    vi.stubGlobal("fetch", mockApi(lifecycleMembers));
    renderSection();
    await screen.findByTestId("members-section");

    const edRow = await findMemberRow(/ed@x\.io/);
    await openMemberMenu(userEvent.setup(), edRow);
    expect(screen.queryByTestId("member-make-owner")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /transfer ownership/i })).not.toBeInTheDocument();
  });

  it.each([
    ["member-disable", "disabled", /cannot open this company until you restore them/i],
    ["member-archive", "archived", /filed away and cannot open this company/i],
  ])("confirms %s before PATCHing the new status", async (testId, status, consequence) => {
    const user = userEvent.setup();
    const fetchMock = mockApi(lifecycleMembers);
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const edRow = await findMemberRow(/ed@x\.io/);

    await chooseMemberAction(user, edRow, testId);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(consequence)).toBeInTheDocument();
    // Opening the confirmation is not the write.
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/status"), expect.anything());

    await user.click(
      within(dialog).getByRole("button", { name: new RegExp(status === "disabled" ? "Disable" : "Archive") }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members/ed/status`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status }) }),
      ),
    );
    await waitFor(() => expect(useStore.getState().notice?.message).toBe(m.settings_members_status_changed()));
  });
}

function registerLifecycleVisibilityTests(): void {
  it("badges a non-active member and offers restore INSTEAD of disable/archive", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi([
      { userId: "me", role: "owner", isSelf: true },
      { userId: "ed", role: "editor", status: "disabled" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await openInactiveGroup(user);
    const edRow = await findMemberRow(/ed@x\.io/);
    // A non-active member must stay REACHABLE and legible, or the state is unreversible.
    expect(within(edRow).getByTestId("member-status")).toHaveTextContent(m.settings_member_status_disabled());

    await openMemberMenu(user, edRow);
    expect(screen.queryByTestId("member-disable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-archive")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("member-restore"));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /restore/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members/ed/status`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "active" }) }),
      ),
    );
  });

  it("hides the role pencil on a non-active row while keeping the gear's actions", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockApi([
        { userId: "me", role: "owner", isSelf: true },
        { userId: "ed", role: "editor", status: "disabled", mayResetPassword: true, mayRevokeSessions: true },
      ]),
    );
    renderSection();
    await openInactiveGroup(user);
    const edRow = await findMemberRow(/ed@x\.io/);

    // A role change writes status: "active", so offering the pencil here would turn "edit their role"
    // into a silent reinstatement. Restore is the only way back, and it is its own audited action.
    expect(within(edRow).queryByTestId("member-edit")).not.toBeInTheDocument();

    // The gear is NOT withdrawn with it: disabling someone must never cost an administrator the
    // ability to rotate their password, kill their sessions, or remove them outright.
    await openMemberMenu(user, edRow);
    expect(screen.getByTestId("member-reset-password")).toBeInTheDocument();
    expect(screen.getByTestId("member-revoke-sessions")).toBeInTheDocument();
    expect(screen.getByTestId("member-remove")).toBeInTheDocument();
  });
}

function registerLifecycleDisclosureTests(): void {
  it("keeps non-active members out of the main table and behind a collapsed disclosure", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockApi([
        { userId: "me", role: "owner", isSelf: true },
        { userId: "ed", role: "editor", status: "disabled" },
        { userId: "vic", role: "viewer", status: "archived" },
      ]),
    );
    renderSection();

    // The main table is the TEAM. Two of these three memberships are history and must not pad it out.
    const mainTable = await screen.findByTestId("members-table");
    expect(within(mainTable).getAllByTestId("member-row")).toHaveLength(1);
    expect(within(mainTable).queryByText(/ed@x\.io/)).not.toBeInTheDocument();

    // Collapsed by default: the group is announced with its count, but lists nobody until asked.
    const toggle = screen.getByTestId("members-inactive-toggle");
    expect(toggle).toHaveTextContent(m.settings_members_inactive_group({ count: 2 }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("members-inactive-table")).not.toBeInTheDocument();

    const inactiveTable = await openInactiveGroup(user);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Both non-active states share one group; the per-row badge is what tells them apart.
    const badges = within(inactiveTable)
      .getAllByTestId("member-status")
      .map((badge) => badge.textContent);
    expect(badges).toEqual([m.settings_member_status_disabled(), m.settings_member_status_archived()]);

    // It closes again — this is a disclosure, not a one-way reveal.
    await user.click(toggle);
    expect(screen.queryByTestId("members-inactive-table")).not.toBeInTheDocument();
  });

  it("omits the disclosure entirely when every membership is active", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi([
        { userId: "me", role: "owner", isSelf: true },
        { userId: "ed", role: "editor" },
      ]),
    );
    renderSection();
    // An empty "No longer active (0)" control would be a permanent reminder of nothing.
    await screen.findByTestId("members-table");
    expect(screen.queryByTestId("members-inactive-toggle")).not.toBeInTheDocument();
  });
}

function registerLifecyclePermissionTests(lifecycleMembers: RawMember[]): void {
  it("offers no status action against the Owner or against yourself", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockApi([
        { userId: "me", role: "admin", isSelf: true, mayRevokeSessions: true },
        { userId: "owner", role: "owner" },
      ]),
    );
    renderSection();
    const selfRow = await findMemberRow(/me@x\.io/);

    // Self-suspension would be an unrecoverable in-app lockout; the Owner is protected because the
    // single-active-Owner invariant keys on role='owner' AND status='active'.
    await openMemberMenu(user, selfRow);
    expect(screen.queryByTestId("member-disable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-archive")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const ownerRow = await findMemberRow(/owner@x\.io/);
    expect(within(ownerRow).queryByTestId("member-menu")).not.toBeInTheDocument();
  });

  it("surfaces a refused status change instead of reporting success", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockApi(lifecycleMembers, {
        "PATCH /members/ed/status": () => jsonResponse({ error: "Forbidden." }, 403),
      }),
    );
    renderSection();
    const edRow = await findMemberRow(/ed@x\.io/);

    await chooseMemberAction(user, edRow, "member-disable");
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /disable/i }));

    expect(await screen.findByText("Forbidden.")).toBeInTheDocument();
    expect(useStore.getState().notice?.message).not.toBe(m.settings_members_status_changed());
  });
}

function registerLifecycleTrackingTests(): void {
  it("renders only coarse sign-in confirmation when the owner has enabled it", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi([
        { userId: "me", role: "owner", isSelf: true, signInConfirmed: true },
        { userId: "ed", role: "editor", signInConfirmed: false },
      ]),
    );
    renderSection();
    const selfRow = await findMemberRow(/me@x\.io/);
    const edRow = await findMemberRow(/ed@x\.io/);

    expect(within(selfRow).getByTestId("member-sign-in-confirmed")).toHaveTextContent(
      m.settings_member_sign_in_confirmed(),
    );
    expect(within(edRow).getByTestId("member-sign-in-confirmed")).toHaveTextContent(
      m.settings_member_sign_in_not_confirmed(),
    );
    expect(screen.queryByText(/2026|unknown/i)).not.toBeInTheDocument();
  });

  it("lets only the owner opt in and keeps edit then settings in separate right-hand columns", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", makeSignInTrackingApi());
    renderSection();

    const tracking = await screen.findByTestId("member-sign-in-tracking");
    expect(tracking).not.toBeChecked();
    expect(screen.getByText(/no dates or activity history are kept/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: m.settings_member_col_sign_in_confirmed() }),
    ).not.toBeInTheDocument();

    await user.click(tracking);
    await waitFor(() => expect(tracking).toBeChecked());
    const table = screen.getByTestId("members-table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      m.settings_member_col_name(),
      m.settings_member_col_email(),
      m.settings_member_col_sign_in_confirmed(),
      m.settings_member_col_edit(),
      m.settings_member_col_settings(),
    ]);
    const editorRow = requireValue(
      within(table)
        .getAllByTestId("member-row")
        .find((row) => within(row).queryByText("Clark Kent")),
      "the Clark Kent row in the members table",
    );
    const cells = within(editorRow).getAllByRole("cell");
    expect(cells).toHaveLength(5);
    expect(within(requireValue(cells[3], "the edit cell")).getByTestId("member-edit")).toBeInTheDocument();
    expect(within(requireValue(cells[4], "the settings cell")).getByTestId("member-menu")).toBeInTheDocument();
  });
}

function registerLifecycleReconciliationTests(): void {
  it("reconciles an unknown self-demotion even after member reads become forbidden", async () => {
    const user = userEvent.setup();
    let mutationDispatched = false;
    const refreshAuth = vi.fn(async () => {});
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/members/me") && init?.method === "PATCH") {
        mutationDispatched = true;
        throw new TypeError("connection closed after dispatch");
      }
      if (u.endsWith("/api/accounts")) {
        return jsonResponse([{ id: DEFAULT_ACCOUNT_ID, name: "Wayne Enterprises", role: "editor" }]);
      }
      if (u.endsWith("/members") && (!init || init.method === undefined || init.method === "GET")) {
        if (mutationDispatched) {
          return jsonResponse({ error: "Forbidden." }, 403);
        }
        return jsonResponse({
          members: [
            rawMember({ userId: "owner", role: "owner" }),
            rawMember({ userId: "me", role: "admin", isSelf: true, mayResetPassword: true, mayRevokeSessions: true }),
            rawMember({ userId: "ed", role: "editor", mayResetPassword: true, mayRevokeSessions: true }),
          ],
        });
      }
      if (u.endsWith("/invites")) {
        return mutationDispatched ? jsonResponse({ error: "Forbidden." }, 403) : jsonResponse({ invites: [] });
      }
      throw new Error(`Unexpected request: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const revisionBefore = useStore.getState().membershipRevision;
    renderSection({ refreshAuth });
    await screen.findByTestId("members-section");

    const self = await findMemberRow(/me@x\.io/);
    await saveRoleVia(user, self, "Editor");

    await waitFor(() => expect(useStore.getState().membershipRevision).toBe(revisionBefore + 1));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(refreshActiveAccountSlice).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
    expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(useStore.getState().notice?.message).toMatch(/Your access was refreshed; verify the result/i);
    expect(useStore.getState().notice?.message).not.toMatch(/Reload the page/i);
  });
}

function registerLifecycleConcurrencyTests(): void {
  it("permits only one member mutation while an action is in flight", async () => {
    let release: (() => void) | null = null;
    const reads = mockApi([
      { userId: "me", role: "owner", isSelf: true },
      { userId: "ed", role: "editor" },
    ]);
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" || init?.method === "DELETE" || init?.method === "PATCH") {
        return new Promise<Response>((resolve) => {
          release = () => resolve(new Response(null, { status: 204 }));
        });
      }
      return reads(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const editorRow = await findMemberRow(/ed@x\.io/);

    const user = userEvent.setup();
    await chooseMemberAction(user, editorRow, "member-disable");
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /disable/i }));

    // While the first mutation is in flight the row's own affordances are disabled, so a second
    // action cannot even be raised — the beginAction lock and the disabled state agree.
    await waitFor(() => expect(within(editorRow).getByTestId("member-menu")).toBeDisabled());
    expect(within(editorRow).getByTestId("member-edit")).toBeDisabled();
    await user.click(within(editorRow).getByTestId("member-menu"));
    expect(screen.queryByText(m.settings_member_settings_heading())).not.toBeInTheDocument();

    const mutations = fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== "GET");
    expect(mutations).toHaveLength(1);
    expect(String(mutations[0]?.[0])).toContain("/status");
    requireCallback(release, "the pending member mutation release callback")();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(3));
  });
}
