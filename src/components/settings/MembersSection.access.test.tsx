import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthContext } from "../../auth/authContext";

import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { refreshActiveAccountSlice } from "../../data/persist";
import { setOfflineReadState } from "../../data/offlineCache";
import { m } from "@/i18n";
import { MembersSection } from "./MembersSection";
import { useTeamDirectory } from "./useTeamDirectory";
import { authValue, mockApi, rawMember, renderSection } from "./MembersSection.testSupport";

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

describe("MembersSection — self-gate", () => {
  registerAccountTransitionTest();

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

  registerSelfGateDisplayTests();
});

describe("MembersSection — directory error retention", () => {
  it("clears the authorized directory snapshot when a same-account refresh loses access", async () => {
    const members = [{ userId: "me", role: "owner", isSelf: true }] as const;
    let memberReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi([...members], {
        "GET /members": () => {
          memberReads += 1;
          return memberReads === 1
            ? jsonResponse({ signInTrackingEnabled: false, members: members.map((member) => rawMember(member)) })
            : jsonResponse({ error: "Forbidden" }, 403);
        },
      }),
    );
    const fail = vi.fn();

    const { result } = renderHook(() =>
      useTeamDirectory({
        enabled: true,
        activeAccountId: DEFAULT_ACCOUNT_ID,
        offlineReadOnly: false,
        fail,
      }),
    );
    await waitFor(() => expect(result.current.directory.kind).toBe("ready"));

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.directory.kind).toBe("error"));
    expect(result.current.directory).toMatchObject({
      kind: "error",
      accountId: DEFAULT_ACCOUNT_ID,
      content: { kind: "unavailable" },
    });
  });
});

describe("MembersSection — transient directory state", () => {
  it("retains the authorized directory snapshot across a transient same-account failure", async () => {
    const members = [{ userId: "me", role: "owner", isSelf: true }] as const;
    let memberReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi([...members], {
        "GET /members": () => {
          memberReads += 1;
          return memberReads === 1
            ? jsonResponse({ signInTrackingEnabled: false, members: members.map((member) => rawMember(member)) })
            : jsonResponse({ error: "Unavailable" }, 503);
        },
      }),
    );
    const fail = vi.fn();

    const { result } = renderHook(() =>
      useTeamDirectory({
        enabled: true,
        activeAccountId: DEFAULT_ACCOUNT_ID,
        offlineReadOnly: false,
        fail,
      }),
    );
    await waitFor(() => expect(result.current.directory.kind).toBe("ready"));
    const readyDirectory = result.current.directory;
    if (readyDirectory.kind !== "ready") throw new Error("Expected an authorized directory fixture.");

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.directory.kind).toBe("error"));
    expect(result.current.directory).toMatchObject({
      kind: "error",
      accountId: DEFAULT_ACCOUNT_ID,
      content: { kind: "authorized", snapshot: readyDirectory.snapshot },
    });
  });
});

describe("MembersSection — retained authorization behavior", () => {
  it("retains authorization across a transient member refresh failure", async () => {
    const members = [{ userId: "me", role: "owner", isSelf: true }] as const;
    let memberReads = 0;
    const fetchMock = mockApi([...members], {
      "GET /members": () => {
        memberReads += 1;
        if (memberReads === 2) return jsonResponse({ error: "Unavailable" }, 503);
        if (memberReads === 3) return jsonResponse({ error: "Forbidden" }, 403);
        return jsonResponse({ signInTrackingEnabled: false, members: members.map((member) => rawMember(member)) });
      },
      "PUT /member-sign-in-tracking": () => jsonResponse({ enabled: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderSection();
    expect(await screen.findByTestId("member-row")).toHaveTextContent("me@x.io");
    await user.click(screen.getByTestId("member-sign-in-tracking"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");

    await user.click(screen.getByRole("button", { name: m.settings_members_retry() }));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.settings_members_err_access_changed());
    expect(memberReads).toBe(3);
  });
});

function registerSelfGateDisplayTests(): void {
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
}

function registerAccountTransitionTest(): void {
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
}
