import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "@/auth/authContext";
import type { AuthContextValue } from "@/auth/authContext";
import { DEFAULT_ACCOUNT_ID, jsonResponse } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { m } from "@/i18n";
import { MembersSection } from "./MembersSection";

interface ConfirmMemberActionInput {
  user: User;
  row: HTMLElement;
  testId: string;
  confirmationName: RegExp | string;
}

/** Unnormalized member response used by access tests. */
export interface RawMember {
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  status?: string;
  accessDisabled?: boolean;
  membershipPresent?: boolean;
  createdAt?: string;
  signInConfirmed?: boolean | null;
  name?: string | null;
  email?: string | null;
  isSelf?: boolean;
  mayResetPassword?: boolean;
  mayRevokeSessions?: boolean;
  resourceLink?: { resourceId: string; revision: string; resourceName?: string | null } | null;
  resourceLinkException?: {
    proposedResourceId: string | null;
    reason: "resource_unavailable" | "resource_already_linked" | "member_already_linked";
  } | null;
}

/** Builds a complete member fixture while leaving signInConfirmed absent unless requested; presence of that field determines whether sign-in tracking is reported enabled. */
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

/** Builds a request mock with per-method/path-suffix overrides. Matching overrides replace defaults; an empty suffix matches all paths for that method. */
export function mockApi(members: RawMember[] | { status: number } = [], overrides: Record<string, RouteHandler> = {}) {
  const defaults: Record<string, RouteHandler> = {
    "GET /members": () =>
      "status" in members
        ? jsonResponse({}, members.status)
        : jsonResponse({
            signInTrackingEnabled: members.some((member) => member.signInConfirmed !== undefined),
            members: members.map((member) => rawMember(member)),
            resourceCandidates: useStore
              .getState()
              .data.resources.filter(
                (resource) => resource.kind === "person" && !resource.archivedAt && !resource.deletedAt,
              )
              .map((resource) => ({ resourceId: resource.id, label: resource.name ?? resource.role })),
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

    return new Response(null, { status: 204 });
  });
}

/** Provides a stateful sign-in tracking response for team access tests. */
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
      // Compute signInConfirmed from the live tracking setting so the response tests opt-in changes rather than a fixed per-member value.
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

/** Creates an auth context value for member section tests. */
export const authValue = (over: Partial<AuthContextValue> = {}): AuthContextValue => ({
  authMode: "password-only",
  user: { id: "me", email: "me@x.io" },
  canCreateAccount: true,
  refreshAuth: async () => {},
  signOut: async () => {},
  ...over,
});

/** Renders the member section with the supplied authentication context. */
export function renderSection(authOverrides: Partial<AuthContextValue> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authValue(authOverrides)}>
        <MembersSection />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

/** Represents the user-event interface used by the member section tests. */
export type User = ReturnType<typeof userEvent.setup>;

/** Returns a defined value or throws with the supplied test context. */
export function requireValue<T>(value: T | undefined, context: string): T {
  if (value === undefined) throw new Error(`Expected ${context}`);
  return value;
}

/** Returns a callback or throws with the supplied test context. */
export function requireCallback(value: (() => void) | null, context: string): () => void {
  if (value === null) throw new Error(`Expected ${context}`);
  return value;
}

/** Opens a member's action menu. Portal items are queried from `screen`. */
export async function openMemberMenu(user: User, row: HTMLElement): Promise<void> {
  await user.click(within(row).getByTestId("member-menu"));
  await screen.findByText(m.settings_member_settings_heading());
}

/** Disabled and archived rows live behind a collapsed disclosure, open it before reaching
 * for one. Returns once the second table is on screen. */
export async function openInactiveGroup(user: User): Promise<HTMLElement> {
  await user.click(await screen.findByTestId("members-inactive-toggle"));
  return screen.findByTestId("members-inactive-table");
}

/** Open a row's gear menu and choose one action by test id. */
export async function chooseMemberAction(user: User, row: HTMLElement, testId: string): Promise<void> {
  await openMemberMenu(user, row);
  await user.click(screen.getByTestId(testId));
}

/** Selects a role in the edit dialog and saves the draft. No write occurs before Save. */
export async function saveRoleVia(user: User, row: HTMLElement, option: string): Promise<void> {
  await user.click(within(row).getByTestId("member-edit"));
  const dialog = await screen.findByRole("dialog");
  fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: option }));
  await user.click(within(dialog).getByTestId("member-role-save"));
}

/** Finds a rendered member row whose email matches the supplied pattern. */
export async function waitForMemberRow(email: RegExp): Promise<HTMLElement> {
  return requireValue(
    (await screen.findAllByTestId("member-row")).find((candidate) => within(candidate).queryByText(email)),
    `a member row matching ${email}`,
  );
}

/** Confirms the selected member action in the alert dialog. */
export async function confirmMemberAction({
  user,
  row,
  testId,
  confirmationName,
}: ConfirmMemberActionInput): Promise<void> {
  await chooseMemberAction(user, row, testId);
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: confirmationName }));
}

/** Test members representing an owner and editor with distinct permissions. */
export const ownerAndEditor: RawMember[] = [
  { userId: "owner", role: "owner" },
  { userId: "me", role: "admin", isSelf: true, mayRevokeSessions: true },
  { userId: "ed", role: "editor", mayResetPassword: true, mayRevokeSessions: true },
];

/** Test members for an owner who is the only owner, plus an editor. */
export const soleOwnerAndEditor: RawMember[] = [
  { userId: "me", role: "owner", isSelf: true },
  { userId: "ed", role: "editor" },
];

/** Test members with names that exercise accessible row labels. */
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

/** Expected accessible labels for the test members. */
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

/** Checks that each member row exposes its expected accessible controls. */
export async function expectAccessibleMemberControls({
  user,
  rows,
  name,
  member,
}: AccessibleMemberControlsInput): Promise<void> {
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
    `Disable Access for ${member}`,
    `Archive ${member}`,
    `Remove ${member}`,
  ]) {
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  }
  await user.keyboard("{Escape}");
}

/** Stubs `window.location.reload` and returns its mock function. */
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

/** Waits until the store notice matches the supplied message. */
export async function expectNotice(message: RegExp): Promise<void> {
  await waitFor(() => expect(useStore.getState().notice?.message).toMatch(message));
}
