import { requireCreated } from "../../test/requireCreated";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse, makeResourceDraft } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { refreshActiveAccountSlice } from "../../data/persist";
import { setOfflineReadState } from "../../data/offlineCache";
import { m } from "@/i18n";
import { teamAccessClient } from "../../account/teamAccessClient";
import * as resourceAvatars from "../../account/useResourceAvatars";
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
  registerMemberResourceLinkTests();
});

function registerMemberResourceLinkTests(): void {
  it("reconciles an uncertain Resource link and invalidates derived pictures", async () => {
    const user = userEvent.setup();
    requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne" })));
    const fetchMock = mockApi([
      { userId: "me", role: "owner", isSelf: true },
      { userId: "ed", role: "editor", name: "Clark Kent" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(teamAccessClient, "setMemberResourceLink").mockResolvedValue({
      kind: "unknown",
      status: 409,
      message: "The operation may have completed.",
    });
    const invalidate = vi.spyOn(resourceAvatars, "invalidateResourceAvatars");
    renderSection();
    const row = await findMemberRow(/ed@x\.io/);
    await user.click(within(row).getByTestId("member-resource-menu"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /choose Resource/i }));
    await user.click(screen.getByRole("option", { name: "Bruce Wayne" }));
    expect(await within(dialog).findByText(m.settings_member_resource_unknown())).toBeInTheDocument();
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/members")).length).toBeGreaterThan(1);
  });

  it("keeps member actions distinct and opens Resource linking from its own icon", async () => {
    const user = userEvent.setup();
    useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne" }));
    vi.stubGlobal(
      "fetch",
      mockApi([
        { userId: "me", role: "owner", isSelf: true },
        { userId: "ed", role: "editor", mayResetPassword: true, mayRevokeSessions: true },
      ]),
    );
    renderSection();

    const row = await findMemberRow(/ed@x\.io/);
    expect(within(row).getByTestId("member-masquerade")).toBeInTheDocument();
    expect(within(row).getByTestId("member-edit")).toBeInTheDocument();
    expect(within(row).getByTestId("member-resource-menu")).toBeInTheDocument();
    expect(within(row).getByTestId("member-menu")).toBeInTheDocument();
    expect(within(row).getByTestId("member-resource-status")).toHaveTextContent("None");
    const actionCell = requireValue(within(row).getAllByRole("cell")[4], "the action cell");
    expect(actionCell).toHaveClass("px-4", "text-right", "whitespace-nowrap");
    expect(actionCell.firstElementChild).toHaveClass("flex", "justify-end", "gap-1");

    await user.click(within(row).getByTestId("member-resource-menu"));
    const resourceDialog = await screen.findByRole("dialog");
    expect(within(row).getByTestId("member-resource-menu")).toBeInTheDocument();
    expect(resourceDialog).toHaveAccessibleName(m.settings_member_col_scheduled_person());
    expect(within(resourceDialog).getByTestId("member-resource-link")).toBeInTheDocument();
    await user.click(within(resourceDialog).getByRole("button", { name: /close/i }));

    const settingsTrigger = within(row).getByTestId("member-menu");
    await user.click(settingsTrigger);
    const settingsDialog = await screen.findByRole("dialog");
    expect(within(row).getByTestId("member-menu")).toBeInTheDocument();
    expect(within(settingsDialog).queryByTestId("member-resource-status")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(settingsTrigger).toHaveFocus());
  });

  it("shows schedule attention and clears it through choose-another-person", async () => {
    const user = userEvent.setup();
    const resource = requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne" })));
    const members: RawMember[] = [
      { userId: "me", role: "owner", isSelf: true },
      {
        userId: "ed",
        role: "editor",
        name: "Clark Kent",
        resourceLinkException: { proposedResourceId: "missing", reason: "resource_unavailable" },
      },
    ];
    const fetchMock = mockApi(members, {
      "PUT /members/ed/resource-link": () => jsonResponse({ resourceId: resource.id, revision: "rev-2" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const row = await findMemberRow(/ed@x\.io/);
    expect(row).toHaveTextContent("Resource link needs attention");
    expect(row).toHaveTextContent("That Resource is no longer available.");

    await user.click(within(row).getByTestId("member-resource-menu"));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByRole("combobox", { name: /choose Resource/i });
    expect(select).toHaveFocus();
    await user.click(select);
    await user.click(screen.getByRole("option", { name: "Bruce Wayne" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/members/ed/resource-link"), expect.anything()),
    );
  });

  it("announces a completed Resource-link save inside the open dialog", async () => {
    const user = userEvent.setup();
    const resource = requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne" })));
    let linked = false;
    const fetchMock = mockApi(
      [
        { userId: "me", role: "owner", isSelf: true },
        { userId: "ed", role: "editor", name: "Clark Kent" },
      ],
      {
        "GET /members": () =>
          jsonResponse({
            members: [
              rawMember({ userId: "me", role: "owner", isSelf: true }),
              rawMember({
                userId: "ed",
                role: "editor",
                name: "Clark Kent",
                resourceLink: linked ? { resourceId: resource.id, revision: "rev-2" } : null,
              }),
            ],
            resourceCandidates: [{ resourceId: resource.id, label: "Bruce Wayne" }],
          }),
        "PUT /members/ed/resource-link": () => {
          linked = true;
          return jsonResponse({ resourceId: resource.id, revision: "rev-2" });
        },
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const row = await findMemberRow(/ed@x\.io/);
    await user.click(within(row).getByTestId("member-resource-menu"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /choose Resource/i }));
    await user.click(screen.getByRole("option", { name: "Bruce Wayne" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Resource link updated.");
  });

  it("dismisses a schedule attention exception and refreshes the directory", async () => {
    const resource = requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne" })));
    const fetchMock = mockApi(
      [
        { userId: "me", role: "owner", isSelf: true },
        {
          userId: "ed",
          role: "editor",
          name: "Clark Kent",
          resourceLinkException: { proposedResourceId: resource.id, reason: "resource_already_linked" },
        },
      ],
      { "DELETE /members/ed/resource-link-exception": () => new Response(null, { status: 204 }) },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const row = await findMemberRow(/ed@x\.io/);
    await userEvent.click(within(row).getByTestId("member-resource-menu"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/members/ed/resource-link-exception"),
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("retains the current inactive person for direct unlink and reconciles after the write", async () => {
    const resource = requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne" })));
    useStore.getState().updateResource(resource.id, { archivedAt: "2026-09-14T10:00:00.000Z" });
    const fetchMock = mockApi([
      { userId: "me", role: "owner", isSelf: true },
      {
        userId: "ed",
        role: "editor",
        name: "Clark Kent",
        resourceLink: { resourceId: resource.id, resourceName: "Bruce Wayne", revision: "rev-1" },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const row = await findMemberRow(/ed@x\.io/);
    expect(within(row).getByTestId("member-resource-status")).toHaveTextContent("Bruce Wayne");
    expect(within(row).queryByRole("button", { name: /change Resource/i })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByTestId("member-resource-menu"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: /remove Resource link/i }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/members/ed/resource-link`),
        expect.objectContaining({ method: "DELETE", body: JSON.stringify({ expectedRevision: "rev-1" }) }),
      ),
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/members"))).toHaveLength(2);
  });

  // The server authorizes candidates; the Resources list only orders them. A candidate the client
  // store has not loaded yet (a person created in another session, or a poll that has not landed)
  // must still be offered, and a live link to one must not be reported as inactive.
  it("offers a server candidate the Resources store has not loaded and orders the rest by Resources", async () => {
    const diana = requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Diana Prince" })));
    const bruce = requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne" })));
    const fetchMock = mockApi(
      [
        { userId: "me", role: "owner", isSelf: true },
        {
          userId: "ed",
          role: "editor",
          resourceLink: { resourceId: "r-server-only", resourceName: "Barry Allen", revision: "rev-1" },
        },
      ],
      {
        "GET /members": () =>
          jsonResponse({
            signInTrackingEnabled: false,
            members: [
              rawMember({ userId: "me", role: "owner", isSelf: true }),
              rawMember({
                userId: "ed",
                role: "editor",
                resourceLink: { resourceId: "r-server-only", resourceName: "Barry Allen", revision: "rev-1" },
              }),
            ],
            // Deliberately unsorted, and carrying a person the store does not have.
            resourceCandidates: [
              { resourceId: "r-server-only", label: "Barry Allen" },
              { resourceId: diana.id, label: "Diana Prince" },
              { resourceId: bruce.id, label: "Bruce Wayne" },
            ],
          }),
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const row = await findMemberRow(/ed@x\.io/);
    expect(within(row).getByTestId("member-resource-status")).toHaveTextContent("Barry Allen");
    expect(within(row).queryByText(/inactive — unlink only/)).not.toBeInTheDocument();
    await userEvent.click(within(row).getByTestId("member-resource-menu"));
    const dialog = await screen.findByRole("dialog");
    const selector = within(dialog).getByTestId("member-resource-link");
    await userEvent.click(selector);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      m.settings_member_resource_unlinked(),
      "Bruce Wayne",
      "Diana Prince",
      "Barry Allen",
    ]);
  });

  it("focuses the selector on open and restores focus to the trigger on close", async () => {
    const user = userEvent.setup();
    const resource = requireCreated(useStore.getState().addResource(makeResourceDraft({ name: "Bruce Wayne" })));
    const fetchMock = mockApi(
      [
        { userId: "me", role: "owner", isSelf: true },
        { userId: "ed", role: "editor", name: "Clark Kent" },
      ],
      {
        "PUT /members/ed/resource-link": () => jsonResponse({ resourceId: resource.id, revision: "rev-2" }),
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const row = await findMemberRow(/ed@x\.io/);
    const trigger = within(row).getByTestId("member-resource-menu");
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByRole("combobox", { name: /choose Resource/i });
    expect(select).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: /close/i }));
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
}

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
    const expectedColumns = ["Name", "Role", "Email", "Link to Resource", "Actions"];
    expect(
      within(mainTable)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(expectedColumns);
    expect(
      within(inactiveTable)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(expectedColumns);
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
  it("keeps complete legacy email values in the DOM and title without assuming they are valid", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi([
        { userId: "me", role: "owner", isSelf: true, email: null },
        { userId: "legacy", role: "viewer", email: "not an email value" },
      ]),
    );
    renderSection();
    const missing = within(await findMemberRow(/No email/i)).getByTestId("member-email");
    expect(missing).toHaveTextContent(m.settings_member_email_missing());
    expect(within(missing).getByText(m.settings_member_email_missing())).not.toHaveAttribute("title");
    const malformed = within(await findMemberRow(/not an email value/i)).getByTestId("member-email");
    const fullValue = within(malformed).getByText("not an email value");
    expect(fullValue).toHaveClass("truncate");
    expect(fullValue).toHaveAttribute("title", "not an email value");
  });

  it("keeps sign-in confirmation absent when the stored setting is enabled", async () => {
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

    expect(within(selfRow).queryByTestId("member-sign-in-confirmed")).not.toBeInTheDocument();
    expect(within(edRow).queryByTestId("member-sign-in-confirmed")).not.toBeInTheDocument();
    expect(screen.queryByText(/2026|unknown/i)).not.toBeInTheDocument();
  });

  it("hides sign-in tracking and uses the fixed five-column table", async () => {
    vi.stubGlobal("fetch", makeSignInTrackingApi());
    renderSection();

    await screen.findByTestId("members-table");
    expect(screen.queryByTestId("member-sign-in-tracking")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: m.settings_member_col_sign_in_confirmed() }),
    ).not.toBeInTheDocument();

    const table = screen.getByTestId("members-table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      m.settings_member_col_name(),
      m.settings_invite_role_label(),
      m.settings_member_col_email(),
      m.settings_member_col_scheduled_person(),
      m.settings_member_col_actions(),
    ]);
    const editorRow = requireValue(
      within(table)
        .getAllByTestId("member-row")
        .find((row) => within(row).queryByText("Clark Kent")),
      "the Clark Kent row in the members table",
    );
    const cells = within(editorRow).getAllByRole("cell");
    expect(cells).toHaveLength(5);
    const actionCell = requireValue(cells[4], "the actions cell");
    expect(within(actionCell).getByTestId("member-masquerade")).toHaveAttribute("data-variant", "outline");
    expect(within(actionCell).getByTestId("member-edit")).toHaveAttribute("data-variant", "outline");
    expect(within(actionCell).getByTestId("member-resource-menu")).toHaveAttribute("data-variant", "outline");
    expect(within(actionCell).getByTestId("member-menu")).toHaveAttribute("data-variant", "outline");
    expect(within(editorRow).getByTestId("member-email")).toHaveClass("text-xs");
    expect(screen.getByTestId("members-section")).not.toHaveAttribute("data-slot", "card");
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
