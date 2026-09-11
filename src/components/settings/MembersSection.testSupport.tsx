import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../../auth/authContext";
import { DEFAULT_ACCOUNT_ID, jsonResponse } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { m } from "@/i18n";
import { MembersSection } from "./MembersSection";

interface ConfirmMemberActionInput {
  user: User;
  row: HTMLElement;
  testId: string;
  confirmationName: RegExp | string;
}

export interface RawMember {
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
export function rawMember(overrides: Partial<RawMember> & { userId: string; role: RawMember["role"] }): RawMember {
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
export function mockApi(members: RawMember[] | { status: number } = [], overrides: Record<string, RouteHandler> = {}) {
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

export function makeSignInTrackingApi(): ReturnType<typeof vi.fn> {
  let trackingEnabled = false;
  const members: RawMember[] = [
    { userId: "me", role: "owner", isSelf: true },
    { userId: "ed", name: "Clark Kent", email: "clark@example.test", role: "editor" },
  ];
  return vi.fn(async (url: string, init?: RequestInit) => {
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
    if (endpoint.endsWith("/invites")) return jsonResponse({ invites: [] });
    return new Response(null, { status: 204 });
  });
}

export const authValue = (over: Partial<AuthContextValue> = {}): AuthContextValue => ({
  authMode: "password",
  user: { id: "me", email: "me@x.io" },
  canCreateAccount: true,
  multiAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
  ...over,
});

export function renderSection(authOverrides: Partial<AuthContextValue> = {}) {
  return render(
    <AuthContext.Provider value={authValue(authOverrides)}>
      <MembersSection />
    </AuthContext.Provider>,
  );
}

export type User = ReturnType<typeof userEvent.setup>;

export function requireValue<T>(value: T | undefined, context: string): T {
  if (value === undefined) throw new Error(`Expected ${context}`);
  return value;
}

export function requireCallback(value: (() => void) | null, context: string): () => void {
  if (value === null) throw new Error(`Expected ${context}`);
  return value;
}

/** Row actions moved behind the row's gear popover (#175). Open it; the popover renders in a
 *  PORTAL, so its items are reachable from `screen`, never from `within(row)`. */
export async function openMemberMenu(user: User, row: HTMLElement): Promise<void> {
  await user.click(within(row).getByTestId("member-menu"));
  await screen.findByText(m.settings_member_settings_heading());
}

/** Disabled and archived rows live behind a collapsed disclosure (#175) — open it before reaching
 *  for one. Returns once the second table is on screen. */
export async function openInactiveGroup(user: User): Promise<HTMLElement> {
  await user.click(await screen.findByTestId("members-inactive-toggle"));
  return screen.findByTestId("members-inactive-table");
}

/** Open a row's gear menu and choose one action by test id. */
export async function chooseMemberAction(user: User, row: HTMLElement, testId: string): Promise<void> {
  await openMemberMenu(user, row);
  await user.click(screen.getByTestId(testId));
}

/** The role selector moved out of the row and into the pencil's dialog (#175): open it, pick the
 *  role, then Save. Selecting a role is now a DRAFT — nothing is sent until Save. */
export async function saveRoleVia(user: User, row: HTMLElement, option: string): Promise<void> {
  await user.click(within(row).getByTestId("member-edit"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: option }));
  await user.click(within(dialog).getByTestId("member-role-save"));
}

export async function findMemberRow(email: RegExp): Promise<HTMLElement> {
  return requireValue(
    (await screen.findAllByTestId("member-row")).find((candidate) => within(candidate).queryByText(email)),
    `a member row matching ${email}`,
  );
}

export async function confirmMemberAction({
  user,
  row,
  testId,
  confirmationName,
}: ConfirmMemberActionInput): Promise<void> {
  await chooseMemberAction(user, row, testId);
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: confirmationName }));
}

export const ownerAndEditor: RawMember[] = [
  { userId: "owner", role: "owner" },
  { userId: "me", role: "admin", isSelf: true, mayRevokeSessions: true },
  { userId: "ed", role: "editor", mayResetPassword: true, mayRevokeSessions: true },
];

export const soleOwnerAndEditor: RawMember[] = [
  { userId: "me", role: "owner", isSelf: true },
  { userId: "ed", role: "editor" },
];

export const accessibleNameMembers: RawMember[] = [
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

export const accessibleMemberNames = [
  ["Barbara Gordon", "Barbara Gordon (alice@example.test)"],
  ["James Gordon", "James Gordon (bob@example.test)"],
] as const;

interface AccessibleMemberControlsInput {
  user: User;
  rows: HTMLElement[];
  name: string;
  member: string;
}

export async function expectAccessibleMemberControls({
  user,
  rows,
  name,
  member,
}: AccessibleMemberControlsInput): Promise<void> {
  // Both row affordances name their subject, so a screen reader never hears a bare "Edit".
  expect(screen.getByRole("button", { name: `Edit ${member}` })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: `More actions for ${member}` })).toBeInTheDocument();

  const row = requireValue(
    rows.find((candidate) => within(candidate).queryByText(name)),
    `the ${name} row in the members table`,
  );
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

export function stubPageReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn();
  const windowStub = Object.create(window) as Window;
  Object.defineProperty(windowStub, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  vi.stubGlobal("window", windowStub);
  return reload;
}

export async function expectNotice(message: RegExp): Promise<void> {
  await waitFor(() => expect(useStore.getState().notice?.message).toMatch(message));
}
