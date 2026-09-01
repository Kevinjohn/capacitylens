import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MembersSection } from "./MembersSection";
import { AuthContext, type AuthContextValue } from "../../auth/authContext";
import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { refreshActiveAccountSlice } from "../../data/persist";
import { setOfflineReadState } from "../../data/offlineCache";
import { m } from "@/i18n";

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
  refreshActiveAccountSlice: vi.fn(async () => "reloaded"),
  flushPendingWrites: vi.fn(async () => true),
  suspendServerWrites: vi.fn(() => vi.fn()),
  switchAndAwaitHydration: vi.fn(async (id: string | null) => {
    useStore.getState().setActiveAccount(id);
    return "reloaded";
  }),
}));

interface RawMember {
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  status?: string;
  createdAt?: string;
  signInConfirmed?: boolean | null;
  name?: string | null;
  email?: string | null;
  isSelf?: boolean;
  mayResetPassword?: boolean;
  mayRevokeSessions?: boolean;
}

/** Build a full server-shaped member record from just what a test cares about pinning. Common
 *  defaults (active, a fixed createdAt, an email derived from userId, no name/self/perms) fill the
 *  rest. `signInConfirmed` is deliberately left OFF the result unless the caller passes it: its mere
 *  PRESENCE (not its value) is what the members-read route uses to decide signInTrackingEnabled. */
function rawMember(overrides: Partial<RawMember> & { userId: string; role: RawMember["role"] }): RawMember {
  return {
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    name: null,
    email: `${overrides.userId}@x.io`,
    isSelf: false,
    mayResetPassword: false,
    mayRevokeSessions: false,
    ...overrides,
  };
}

type RouteHandler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** Build a fetch mock from a small default route table (members GET, invites GET, accounts GET, and
 *  a 204 fallback for every write) plus per-test overrides keyed `"METHOD /path-suffix"` — an
 *  override with the same key as a default replaces it; a new key adds a route. An empty suffix
 *  (e.g. `"PATCH "`) matches every URL for that method. A 403 on the members read self-gates the
 *  section. */
function mockApi(members: RawMember[] | { status: number } = [], overrides: Record<string, RouteHandler> = {}) {
  const defaults: Record<string, RouteHandler> = {
    "GET /members": () =>
      "status" in members
        ? jsonResponse({}, members.status)
        : jsonResponse({
            signInTrackingEnabled: members.some((member) => member.signInConfirmed !== undefined),
            members: members.map((member) => rawMember(member)),
          }),
    "GET /invites": () => jsonResponse({ invites: [] }),
    "GET /api/accounts": () => {
      const self = Array.isArray(members) ? members.find((member) => member.isSelf) : undefined;
      return jsonResponse([{ id: DEFAULT_ACCOUNT_ID, name: "Wayne Enterprises", role: self?.role ?? "owner" }]);
    },
  };
  const routes = { ...defaults, ...overrides };
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    for (const [key, handler] of Object.entries(routes)) {
      const space = key.indexOf(" ");
      if (method === key.slice(0, space) && u.endsWith(key.slice(space + 1))) return handler(u, init);
    }
    // Default: a successful no-content mutate.
    return new Response(null, { status: 204 });
  });
}

const authValue = (over: Partial<AuthContextValue> = {}): AuthContextValue => ({
  authMode: "password",
  user: { id: "me", email: "me@x.io" },
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
  ...over,
});

function renderSection(authOverrides: Partial<AuthContextValue> = {}) {
  return render(
    <AuthContext.Provider value={authValue(authOverrides)}>
      <MembersSection />
    </AuthContext.Provider>,
  );
}

type User = ReturnType<typeof userEvent.setup>;

/** Row actions moved behind the row's gear popover (#175). Open it; the popover renders in a
 *  PORTAL, so its items are reachable from `screen`, never from `within(row)`. */
async function openMemberMenu(user: User, row: HTMLElement): Promise<void> {
  await user.click(within(row).getByTestId("member-menu"));
  await screen.findByText(m.settings_member_settings_heading());
}

/** Disabled and archived rows live behind a collapsed disclosure (#175) — open it before reaching
 *  for one. Returns once the second table is on screen. */
async function openInactiveGroup(user: User): Promise<HTMLElement> {
  await user.click(await screen.findByTestId("members-inactive-toggle"));
  return screen.findByTestId("members-inactive-table");
}

/** Open a row's gear menu and choose one action by test id. */
async function chooseMemberAction(user: User, row: HTMLElement, testId: string): Promise<void> {
  await openMemberMenu(user, row);
  await user.click(screen.getByTestId(testId));
}

/** The role selector moved out of the row and into the pencil's dialog (#175): open it, pick the
 *  role, then Save. Selecting a role is now a DRAFT — nothing is sent until Save. */
async function saveRoleVia(user: User, row: HTMLElement, option: string): Promise<void> {
  await user.click(within(row).getByTestId("member-edit"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: option }));
  await user.click(within(dialog).getByTestId("member-role-save"));
}

async function findMemberRow(email: RegExp): Promise<HTMLElement> {
  return (await screen.findAllByTestId("member-row")).find((row) => within(row).queryByText(email))!;
}

async function confirmMemberAction(
  user: User,
  row: HTMLElement,
  testId: string,
  confirmationName: RegExp | string,
): Promise<void> {
  await chooseMemberAction(user, row, testId);
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: confirmationName }));
}

const ownerAndEditor: RawMember[] = [
  { userId: "owner", role: "owner" },
  { userId: "me", role: "admin", isSelf: true, mayRevokeSessions: true },
  { userId: "ed", role: "editor", mayResetPassword: true, mayRevokeSessions: true },
];

function stubPageReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  const windowStub = Object.create(window) as Window;
  Object.defineProperty(windowStub, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  vi.stubGlobal("window", windowStub);
  return reload;
}

async function expectNotice(message: RegExp): Promise<void> {
  await waitFor(() => expect(useStore.getState().notice?.message).toMatch(message));
}

beforeEach(() => {
  accountTransitionMocks.startMasquerade.mockClear();
  resetStoreWithAccount(); // sets activeAccountId = DEFAULT_ACCOUNT_ID
  setOfflineReadState("cleanup", false);
  vi.mocked(refreshActiveAccountSlice).mockResolvedValue("reloaded");
});
afterEach(() => {
  setOfflineReadState("cleanup", false);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MembersSection — self-gate", () => {
  it("hides the previous account directory while the next account is authorizing", async () => {
    const nextAccountId = "acc_second";
    let resolveNextMembers: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const target = String(url);
      const isRead = !init || init.method === undefined || init.method === "GET";
      if (target.endsWith(`/${DEFAULT_ACCOUNT_ID}/members`) && isRead) {
        return jsonResponse({
          members: [rawMember({ userId: "first-owner", role: "owner", email: "first@example.test", isSelf: true })],
        });
      }
      if (target.endsWith(`/${nextAccountId}/members`) && isRead) {
        return await new Promise<Response>((resolve) => {
          resolveNextMembers = resolve;
        });
      }
      if (target.endsWith("/invites") && isRead) {
        return jsonResponse({ invites: [] });
      }
      throw new Error(`Unexpected request: ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    expect(await screen.findByText("first@example.test")).toBeInTheDocument();

    act(() => useStore.setState({ activeAccountId: nextAccountId }));
    expect(screen.queryByText("first@example.test")).not.toBeInTheDocument();

    await act(async () => {
      resolveNextMembers?.(
        jsonResponse({
          members: [rawMember({ userId: "second-owner", role: "owner", email: "second@example.test", isSelf: true })],
        }),
      );
    });
    expect(await screen.findByText("second@example.test")).toBeInTheDocument();
  });

  it("defers privileged directory reads while offline and refreshes them on recovery", async () => {
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }]);
    vi.stubGlobal("fetch", fetchMock);
    setOfflineReadState("tenant", true, Date.parse("2026-07-17T10:00:00.000Z"));
    renderSection();

    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => setOfflineReadState("cleanup", false));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members`,
        expect.objectContaining({ credentials: "include" }),
      ),
    );
  });

  it("renders NOTHING when the members read returns 403 (viewer/editor)", async () => {
    vi.stubGlobal("fetch", mockApi({ status: 403 }));
    const { container } = renderSection();
    // Give the effect a tick to resolve the 403, then assert nothing rendered.
    await waitFor(() => expect(container.querySelector('[data-testid="members-section"]')).toBeNull());
    expect(screen.queryByRole("heading", { name: "Members" })).not.toBeInTheDocument();
  });

  it("surfaces and retries a 403 after the directory was already authorized", async () => {
    const members = [{ userId: "me", role: "owner", isSelf: true }] as const;
    let memberReads = 0;
    const fetchMock = mockApi([...members], {
      "GET /members": () => {
        memberReads += 1;
        return memberReads === 2
          ? jsonResponse({ error: "Forbidden" }, 403)
          : jsonResponse({ signInTrackingEnabled: false, members: members.map((member) => rawMember(member)) });
      },
      "PUT /member-sign-in-tracking": () => jsonResponse({ enabled: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderSection();
    expect(await screen.findByTestId("member-row")).toHaveTextContent("me@x.io");
    // Any write that re-reads the DIRECTORY re-asks "may I still see this section?"; the toggle is
    // the simplest one here (creating an invite re-reads only the invitations it can have changed).
    await user.click(screen.getByTestId("member-sign-in-tracking"));

    expect(await screen.findByRole("alert")).toHaveTextContent(m.settings_members_err_access_changed());
    expect(screen.queryByTestId("member-row")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: m.settings_members_retry() }));
    expect(await screen.findByTestId("member-row")).toHaveTextContent("me@x.io");
    expect(memberReads).toBe(3);
  });

  it("renders nothing when authMode is off", () => {
    vi.stubGlobal("fetch", mockApi([]));
    const { container } = render(
      <AuthContext.Provider value={authValue({ authMode: "off" })}>
        <MembersSection />
      </AuthContext.Provider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an empty directory message without exposing an empty ARIA list", async () => {
    vi.stubGlobal("fetch", mockApi([]));
    renderSection();

    const section = await screen.findByTestId("members-section");
    expect(within(section).queryByTestId("member-row")).not.toBeInTheDocument();
    expect(within(section).queryByRole("list")).not.toBeInTheDocument();
  });

  it("surfaces a malformed member response instead of trusting it", async () => {
    // Deliberately malformed (missing required member fields) — must NOT go through rawMember,
    // which would paper over the very thing this test is pinning.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ members: [{ userId: "me", role: "owner" }] })),
    );
    renderSection();

    expect(await screen.findByText(/invalid members response/i)).toBeInTheDocument();
    expect(screen.queryByTestId("member-row")).not.toBeInTheDocument();
  });

  it("keeps loaded members visible and names a failed invitations read", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "GET /invites": () => jsonResponse({}, 503),
      }),
    );
    renderSection();

    expect(await screen.findByText("me@x.io")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load invites (503).");
    expect(screen.queryByText("Could not load members (503).")).not.toBeInTheDocument();
  });
});

describe("MembersSection — admin affordances", () => {
  const members: RawMember[] = [
    { userId: "me", role: "admin", isSelf: true },
    { userId: "theowner", role: "owner" },
    { userId: "theeditor", role: "editor" },
  ];

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
    expect(email).toHaveAttribute("aria-describedby", error.id);
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

  it("shows no role control + no Remove on an OWNER row (admin can't touch an owner)", async () => {
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    await screen.findByTestId("members-section");

    const rows = await screen.findAllByTestId("member-row");
    const ownerRow = rows.find((r) => within(r).queryByText(/theowner@x\.io/))!;
    expect(ownerRow).toBeTruthy();
    // No pencil on the owner row for an admin, and no gear either: with reset/revoke/status/remove
    // all forbidden against an Owner the menu has nothing left to offer, so it is not rendered.
    expect(within(ownerRow).queryByTestId("member-edit")).not.toBeInTheDocument();
    expect(within(ownerRow).queryByTestId("member-menu")).not.toBeInTheDocument();

    // The editor row, by contrast, IS manageable by the admin.
    const editorRow = rows.find((r) => within(r).queryByText(/theeditor@x\.io/))!;
    expect(within(editorRow).getByTestId("member-edit")).toBeInTheDocument();
    await chooseMemberAction(userEvent.setup(), editorRow, "member-remove");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("offers masquerade for every other active member, including an owner, and confirms by name", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    const rows = await screen.findAllByTestId("member-row");
    const selfRow = rows.find((row) => within(row).queryByText(/me@x\.io/))!;
    const ownerRow = rows.find((row) => within(row).queryByText(/theowner@x\.io/))!;
    const editorRow = rows.find((row) => within(row).queryByText(/theeditor@x\.io/))!;

    expect(within(selfRow).queryByTestId("member-masquerade")).not.toBeInTheDocument();
    expect(within(ownerRow).getByTestId("member-masquerade")).toBeInTheDocument();
    expect(within(editorRow).getByTestId("member-masquerade")).toBeInTheDocument();

    await user.click(within(ownerRow).getByTestId("member-masquerade"));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Confirm you would like to masquerade as theowner@x.io");
    await user.click(within(dialog).getByRole("button", { name: "Start masquerade" }));
    expect(accountTransitionMocks.startMasquerade).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID, "theowner");
  });

  it("names the member and waits for confirmation before sending removal", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(members);
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    const editorRow = (await screen.findAllByTestId("member-row")).find((row) =>
      within(row).queryByText(/theeditor@x\.io/),
    )!;

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
    const editorRow = (await screen.findAllByTestId("member-row")).find((row) =>
      within(row).queryByText(/theeditor@x\.io/),
    )!;

    await chooseMemberAction(user, editorRow, testId);

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(consequence)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  });

  it("uses the message catalogue for session revocation controls and success notices", async () => {
    const user = userEvent.setup();
    const actionableMembers = members.map((member) =>
      member.userId === "theeditor" ? { ...member, mayRevokeSessions: true } : member,
    );
    vi.stubGlobal("fetch", mockApi(actionableMembers));
    renderSection();
    const editorRow = (await screen.findAllByTestId("member-row")).find((row) =>
      within(row).queryByText(/theeditor@x\.io/),
    )!;
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
    const editorRow = (await screen.findAllByTestId("member-row")).find((row) =>
      within(row).queryByText(/theeditor@x\.io/),
    )!;

    await chooseMemberAction(user, editorRow, "member-revoke-sessions");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: m.settings_member_revoke_sessions(),
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(m.settings_members_err_revoke_sessions({ status: 400 }));
  });

  it("spells out access and reload consequences for self-targeted actions", async () => {
    const user = userEvent.setup();
    const selfMembers: RawMember[] = [
      { userId: "me", role: "admin", isSelf: true, mayRevokeSessions: true },
      { userId: "owner", role: "owner" },
    ];
    vi.stubGlobal("fetch", mockApi(selfMembers));
    renderSection();
    const selfRow = (await screen.findAllByTestId("member-row")).find((row) => within(row).queryByText(/me@x\.io/))!;

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

  it("explains and confirms a role change before sending it", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi(members);
    vi.stubGlobal("fetch", fetchMock);
    const revisionBefore = useStore.getState().membershipRevision;
    renderSection();
    const rows = await screen.findAllByTestId("member-row");
    const editorRow = rows.find((r) => within(r).queryByText(/theeditor@x\.io/))!;

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

  it("announces and marks the section busy while a member action is in flight", async () => {
    const user = userEvent.setup();
    let releasePatch!: () => void;
    const patchResponse = new Promise<Response>((resolve) => {
      releasePatch = () => resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal("fetch", mockApi(members, { "PATCH /members/theeditor": () => patchResponse }));
    renderSection();
    const editorRow = (await screen.findAllByTestId("member-row")).find((row) =>
      within(row).queryByText(/theeditor@x\.io/),
    )!;

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

    const selfRow = (await screen.findAllByTestId("member-row")).find((row) => within(row).queryByText(/me@x\.io/))!;
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
      return "reloaded";
    });
    renderSection();

    const selfRow = (await screen.findAllByTestId("member-row")).find((row) => within(row).queryByText(/me@x\.io/))!;
    await saveRoleVia(user, selfRow, "Editor");

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
    expect(useStore.getState().notice?.message).toMatch(/could not be safely refreshed/i);
  });
});

describe("MembersSection — owner affordances", () => {
  it("gives every member-row control a unique member-scoped accessible name", async () => {
    const members: RawMember[] = [
      { userId: "me", role: "owner", isSelf: true },
      {
        userId: "alice",
        name: "Barbara Gordon",
        email: "alice@example.test",
        role: "editor",
        mayResetPassword: true,
        mayRevokeSessions: true,
      },
      {
        userId: "bob",
        name: "James Gordon",
        email: "bob@example.test",
        role: "viewer",
        mayResetPassword: true,
        mayRevokeSessions: true,
      },
    ];
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    await screen.findByTestId("members-section");

    const user = userEvent.setup();
    const rows = screen.getAllByTestId("member-row");
    for (const member of ["Barbara Gordon (alice@example.test)", "James Gordon (bob@example.test)"]) {
      // Both row affordances name their subject, so a screen reader never hears a bare "Edit".
      expect(screen.getByRole("button", { name: `Edit ${member}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `More actions for ${member}` })).toBeInTheDocument();

      const row = rows.find((candidate) => within(candidate).queryByText(member.split(" (")[0]!))!;
      await openMemberMenu(user, row);
      for (const action of [
        `Reset password for ${member}`,
        `Revoke sessions for ${member}`,
        `Disable ${member}`,
        `Archive ${member}`,
        `Remove ${member}`,
      ]) {
        expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
      }
      await user.keyboard("{Escape}");
    }
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("never offers Owner as an ordinary role, even to the Owner", async () => {
    const user = userEvent.setup();
    const members: RawMember[] = [
      { userId: "me", role: "owner", isSelf: true },
      { userId: "ed", role: "editor" },
    ];
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    await screen.findByTestId("members-section");

    fireEvent.keyDown(screen.getByTestId("invite-role"), { key: "ArrowDown" });
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const rows = await screen.findAllByTestId("member-row");
    const editorRow = rows.find((r) => within(r).queryByText(/ed@x\.io/))!;
    await user.click(within(editorRow).getByTestId("member-edit"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "ArrowDown" });
    expect(screen.queryByRole("option", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("keeps the single Owner outside ordinary role and removal controls", async () => {
    const members: RawMember[] = [
      { userId: "me", role: "owner", isSelf: true }, // the only owner
      { userId: "ed", role: "editor" },
    ];
    vi.stubGlobal("fetch", mockApi(members));
    renderSection();
    await screen.findByTestId("members-section");

    const rows = await screen.findAllByTestId("member-row");
    const soleOwnerRow = rows.find((r) => within(r).queryByText(/me@x\.io/))!;
    expect(within(soleOwnerRow).getByTestId("member-role")).toHaveTextContent(m.settings_member_sole_owner_protected());
    // No pencil (the role is not editable) and no gear: nothing in it would be permitted.
    expect(within(soleOwnerRow).queryByTestId("member-edit")).not.toBeInTheDocument();
    expect(within(soleOwnerRow).queryByTestId("member-menu")).not.toBeInTheDocument();
  });
});

describe("MembersSection — member lifecycle", () => {
  // Transfer ownership is deliberately NOT here: #175 removed the per-member button, and the
  // action returns under a follow-up ticket as its own owner-only section. Its server route and
  // client method are untouched, so this describe covers what the ROW can now do instead.
  const lifecycleMembers: RawMember[] = [
    { userId: "me", role: "owner", isSelf: true },
    { userId: "ed", role: "editor" },
  ];

  it("never offers a transfer-ownership control on any row", async () => {
    vi.stubGlobal("fetch", mockApi(lifecycleMembers));
    renderSection();
    await screen.findByTestId("members-section");

    const edRow = (await screen.findAllByTestId("member-row")).find((r) => within(r).queryByText(/ed@x\.io/))!;
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
    const edRow = (await screen.findAllByTestId("member-row")).find((r) => within(r).queryByText(/ed@x\.io/))!;

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

  it("badges a non-active member and offers restore INSTEAD of disable/archive", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi([
      { userId: "me", role: "owner", isSelf: true },
      { userId: "ed", role: "editor", status: "disabled" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    renderSection();
    await openInactiveGroup(user);
    const edRow = (await screen.findAllByTestId("member-row")).find((r) => within(r).queryByText(/ed@x\.io/))!;
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
    const edRow = (await screen.findAllByTestId("member-row")).find((r) => within(r).queryByText(/ed@x\.io/))!;

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
    const selfRow = (await screen.findAllByTestId("member-row")).find((r) => within(r).queryByText(/me@x\.io/))!;

    // Self-suspension would be an unrecoverable in-app lockout; the Owner is protected because the
    // single-active-Owner invariant keys on role='owner' AND status='active'.
    await openMemberMenu(user, selfRow);
    expect(screen.queryByTestId("member-disable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-archive")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const ownerRow = (await screen.findAllByTestId("member-row")).find((r) => within(r).queryByText(/owner@x\.io/))!;
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
    const edRow = (await screen.findAllByTestId("member-row")).find((r) => within(r).queryByText(/ed@x\.io/))!;

    await chooseMemberAction(user, edRow, "member-disable");
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /disable/i }));

    expect(await screen.findByText("Forbidden.")).toBeInTheDocument();
    expect(useStore.getState().notice?.message).not.toBe(m.settings_members_status_changed());
  });

  it("renders only coarse sign-in confirmation when the owner has enabled it", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi([
        { userId: "me", role: "owner", isSelf: true, signInConfirmed: true },
        { userId: "ed", role: "editor", signInConfirmed: false },
      ]),
    );
    renderSection();
    const rows = await screen.findAllByTestId("member-row");
    const selfRow = rows.find((r) => within(r).queryByText(/me@x\.io/))!;
    const edRow = rows.find((r) => within(r).queryByText(/ed@x\.io/))!;

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
    let trackingEnabled = false;
    const members: RawMember[] = [
      { userId: "me", role: "owner", isSelf: true },
      { userId: "ed", name: "Clark Kent", email: "clark@example.test", role: "editor" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const endpoint = String(url);
        if (endpoint.endsWith("/member-sign-in-tracking") && init?.method === "PUT") {
          trackingEnabled = (JSON.parse(String(init.body)) as { enabled: boolean }).enabled;
          return jsonResponse({ enabled: trackingEnabled });
        }
        if (endpoint.endsWith("/members") && (!init || init.method === undefined || init.method === "GET")) {
          // Not routed through rawMember: mayRevokeSessions defaults to true here (not rawMember's
          // false), and signInConfirmed is computed from the live trackingEnabled toggle rather than
          // being a static per-member default.
          return jsonResponse({
            signInTrackingEnabled: trackingEnabled,
            members: members.map((member) => ({
              status: "active",
              createdAt: "2026-01-01T00:00:00.000Z",
              name: null,
              email: `${member.userId}@x.io`,
              isSelf: false,
              mayResetPassword: false,
              mayRevokeSessions: true,
              ...member,
              signInConfirmed: trackingEnabled ? member.isSelf === true : null,
            })),
          });
        }
        if (endpoint.endsWith("/invites")) {
          return jsonResponse({ invites: [] });
        }
        return new Response(null, { status: 204 });
      }),
    );
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
    const editorRow = within(table)
      .getAllByTestId("member-row")
      .find((row) => within(row).queryByText("Clark Kent"))!;
    const cells = within(editorRow).getAllByRole("cell");
    expect(cells).toHaveLength(5);
    expect(within(cells[3]!).getByTestId("member-edit")).toBeInTheDocument();
    expect(within(cells[4]!).getByTestId("member-menu")).toBeInTheDocument();
  });

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

    const self = (await screen.findAllByTestId("member-row")).find((row) => within(row).queryByText(/me@x\.io/))!;
    await saveRoleVia(user, self, "Editor");

    await waitFor(() => expect(useStore.getState().membershipRevision).toBe(revisionBefore + 1));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(refreshActiveAccountSlice).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
    expect(useStore.getState().activeAccountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(useStore.getState().notice?.message).toMatch(/Your access was refreshed; verify the result/i);
    expect(useStore.getState().notice?.message).not.toMatch(/Reload the page/i);
  });

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
    const editorRow = (await screen.findAllByTestId("member-row")).find((row) => within(row).queryByText(/ed@x\.io/))!;

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
    expect(String(mutations[0][0])).toContain("/status");
    release!();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(3));
  });
});

describe("MembersSection — mutation failure reconciliation", () => {
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

    await confirmMemberAction(userEvent.setup(), await findMemberRow(/me@x\.io/), "member-remove", "Remove");

    await waitFor(() => expect(useStore.getState().activeAccountId).toBeNull());
    expect(useStore.getState().notice).toBeNull();
  });

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

  it.each([
    [503, { error: "Uncertain." }, /unknown outcome/i, true],
    [403, { error: "Role forbidden." }, /Role forbidden\./, false],
  ])("handles a %s role-change response without claiming success", async (status, body, expected, reconciles) => {
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
  });

  it.each([
    [503, { error: "Uncertain." }, /unknown outcome/i, true],
    [403, { error: "Last owner cannot be removed." }, /Last owner cannot be removed\./, false],
  ])("handles a %s member-removal response without removing the row", async (status, body, expected, reconciles) => {
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

    await confirmMemberAction(userEvent.setup(), await findMemberRow(/ed@x\.io/), "member-remove", "Remove");

    if (reconciles) await expectNotice(expected);
    else expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByText(/ed@x\.io/)).toBeInTheDocument();
    expect(memberReads).toBe(reconciles ? 2 : 1);
  });

  it("reconciles a 503 status change without claiming success", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, { "PATCH /members/ed/status": () => jsonResponse({ error: "Uncertain." }, 503) }),
    );
    renderSection();

    await confirmMemberAction(userEvent.setup(), await findMemberRow(/ed@x\.io/), "member-disable", /disable/i);

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

    await confirmMemberAction(userEvent.setup(), await findMemberRow(/ed@x\.io/), "member-disable", /disable/i);

    await expectNotice(/unknown outcome.*status connection lost.*reloaded/i);
  });
});

describe("MembersSection — password reset and session failures", () => {
  async function requestReset(): Promise<void> {
    await confirmMemberAction(
      userEvent.setup(),
      await findMemberRow(/ed@x\.io/),
      "member-reset-password",
      "Reset password",
    );
  }

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

  it.each([
    [503, false, false, /unknown outcome/i],
    [503, true, true, null],
  ])("handles a 503 session revocation (status=%s, self=%s)", async (status, self, reloads, expected) => {
    const reload = stubPageReload();
    vi.stubGlobal(
      "fetch",
      mockApi(ownerAndEditor, {
        [`POST /members/${self ? "me" : "ed"}/revoke-sessions`]: () => jsonResponse({}, status),
      }),
    );
    renderSection();
    const row = await findMemberRow(self ? /me@x\.io/ : /ed@x\.io/);

    await confirmMemberAction(userEvent.setup(), row, "member-revoke-sessions", "Revoke sessions");

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(reloads ? 1 : 0));
    if (expected) await expectNotice(expected);
    else expect(useStore.getState().notice).toBeNull();
  });

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

    await confirmMemberAction(
      userEvent.setup(),
      await findMemberRow(self ? /me@x\.io/ : /ed@x\.io/),
      "member-revoke-sessions",
      "Revoke sessions",
    );

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(reloads ? 1 : 0));
    if (!self) await expectNotice(/unknown outcome.*session transport lost/i);
    else expect(useStore.getState().notice).toBeNull();
  });
});

describe("MembersSection — invite mint", () => {
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

    const editorRow = (await screen.findAllByTestId("member-row")).find((row) =>
      within(row).queryByText(/editor@x\.io/),
    )!;
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

    // The post-create reload confirms the invite is still pending, so the write-once link must
    // survive it — this is the reconciliation path the test's name actually promises.
    await waitFor(() => expect(invitesReads).toBeGreaterThanOrEqual(2));
    expect(screen.getByTestId("invite-link")).toHaveTextContent("/invite/TOK123");
  });

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
    expect(field).toHaveAttribute("aria-describedby", alert.id);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it.each([
    [503, { error: "Invite uncertain." }, /unknown outcome.*reloaded/i, false],
    [403, { error: "Invite forbidden." }, /Invite forbidden\./, true],
  ])("handles a %s invite-create response on the current account", async (status, body, expected, fieldError) => {
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
    if (fieldError) expect(screen.getByTestId("invite-preauth")).toHaveAttribute("aria-describedby", alert!.id);
  });

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

  it.each([
    [503, { error: "Revoke uncertain." }, /unknown outcome.*reloaded/i, true],
    [403, { error: "Revoke forbidden." }, /Revoke forbidden\./, false],
  ])("handles a %s invite-revoke response without dropping the row", async (status, body, expected, reconciles) => {
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
  });

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
    await userEvent.setup().click(revokeButtons[1]!);

    await waitFor(() => expect(screen.queryByText(/b@example\.test/)).not.toBeInTheDocument());
    expect(screen.getByTestId("invite-link")).toHaveTextContent("/invite/TOKEN_A");
  });

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
});

describe("MembersSection — SSO cutover repair", () => {
  const providers: AuthContextValue["providers"] = [
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

  it("refreshes readiness after a successful membership mutation", async () => {
    const user = userEvent.setup();
    let readinessReads = 0;
    const fetchMock = mockApi(directory, {
      "GET /sso-readiness": () => {
        readinessReads += 1;
        return jsonResponse(ssoReadiness(false, "member_not_linked"));
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection({ providers });

    const targetRow = (await screen.findAllByTestId("member-row")).find((row) =>
      within(row).queryByText(/target@x\.io/),
    )!;
    await waitFor(() => expect(readinessReads).toBe(1));
    await saveRoleVia(user, targetRow, "Viewer");

    await waitFor(() => expect(readinessReads).toBeGreaterThanOrEqual(2));
  });

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

  it("reloads after correcting the current user's email without refreshing the directory", async () => {
    const reload = stubPageReload();
    const selfReadiness = ssoReadiness(false, "member_not_linked");
    selfReadiness.members[0]!.principalId = "me";
    selfReadiness.members[0]!.email = "me@x.io";
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
    selfReadiness.members[0]!.principalId = "me";
    selfReadiness.members[0]!.email = "me@x.io";
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

  it.each(["resolve", "reject"])("ignores a readiness request that finishes after unmount (%s)", async (outcome) => {
    let settle!: (response?: Response) => void;
    const pending = new Promise<Response>((resolve, reject) => {
      settle = (response) => (outcome === "resolve" ? resolve(response!) : reject(new Error("late readiness")));
    });
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

  it("surfaces a readiness fetch failure instead of hiding the cutover state", async () => {
    vi.stubGlobal("fetch", mockApi(directory, { "GET /sso-readiness": () => jsonResponse({}, 503) }));
    renderSection({ providers });

    expect(await screen.findByTestId("sso-readiness-error")).toHaveTextContent(m.settings_sso_readiness_error());
    expect(screen.queryByTestId("sso-readiness")).not.toBeInTheDocument();
  });

  it("rejects malformed nested readiness coordinates", async () => {
    const malformed = ssoReadiness(true, "unverified_provider_link");
    malformed.members[0]!.repairLinks[0]!.subject = "";
    vi.stubGlobal("fetch", mockApi(directory, { "GET /sso-readiness": () => jsonResponse(malformed) }));
    renderSection({ providers });

    expect(await screen.findByTestId("sso-readiness-error")).toHaveTextContent(m.settings_sso_readiness_error());
  });

  it("does not offer mixed-mode email or link repair after password sign-in is disabled", async () => {
    vi.stubGlobal("fetch", ssoFetch(true, "unverified_provider_link"));
    renderSection({ authMode: "sso", providers });

    expect(await screen.findByTestId("sso-readiness")).toBeInTheDocument();
    expect(screen.queryByTestId("sso-correct-email")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sso-remove-link")).not.toBeInTheDocument();
  });
});

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
