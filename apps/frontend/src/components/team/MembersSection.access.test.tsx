import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AuthContext } from "@/auth/authContext";

import { resetStoreWithAccount, DEFAULT_ACCOUNT_ID, jsonResponse } from "@/test/fixtures";
import { useStore } from "@/store/useStore";
import { MembersSection } from "./MembersSection";
import { useTeamDirectory } from "./useTeamDirectory";
import { authValue, mockApi, rawMember, renderSection } from "./MembersSection.testSupport";

const accountTransitionMocks = vi.hoisted(() => ({
  startMasquerade: vi.fn(async () => true),
}));

vi.mock("@/auth/accountTransition", () => ({
  startMasquerade: accountTransitionMocks.startMasquerade,
}));

vi.mock("@/data/apiConfig", () => ({
  API_BASE: "http://api.test",
  isServerConfigured: () => true,
}));

beforeEach(async () => {
  accountTransitionMocks.startMasquerade.mockClear();
  await resetStoreWithAccount();
});
afterEach(() => {
  useStore.setState({ masquerade: { kind: "inactive" } });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MembersSection — self-gate", () => {
  registerAccountTransitionTest();

  it("renders NOTHING when the members read returns 403 (viewer/editor)", async () => {
    vi.stubGlobal("fetch", mockApi({ status: 403 }));
    const { container } = renderSection();

    await waitFor(() => expect(container.querySelector('[data-testid="members-section"]')).toBeNull());
    expect(screen.queryByRole("heading", { name: "Members" })).not.toBeInTheDocument();
  });

  registerSelfGateDisplayTests();
});

describe("MembersSection — directory error retention", () => {
  it("does not request blocked member or invitation routes during an active masquerade", async () => {
    useStore.setState({
      masquerade: {
        kind: "active",
        generation: 2,
        state: {
          accountId: DEFAULT_ACCOUNT_ID,
          targetUserId: "target-user",
          targetName: "Selina Kyle",
          effectiveRole: "viewer",
          startedAt: "2026-09-01T10:00:00.000Z",
          token: "session-token",
        },
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fail = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(
      () =>
        useTeamDirectory({
          enabled: true,
          activeAccountId: DEFAULT_ACCOUNT_ID,
          fail,
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            <AuthContext.Provider value={authValue()}>{children}</AuthContext.Provider>
          </QueryClientProvider>
        ),
      },
    );
    await act(async () => {});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("masks a previously authorized directory immediately when its principal changes", async () => {
    const members = [{ userId: "me", role: "owner", isSelf: true }] as const;
    let memberReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/members")) {
          memberReads += 1;
          if (memberReads > 1) return new Promise<Response>(() => {});
          return jsonResponse({ signInTrackingEnabled: false, members: members.map((member) => rawMember(member)) });
        }
        if (url.endsWith("/invites")) return jsonResponse({ invites: [] });
        return new Response(null, { status: 204 });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fail = vi.fn();
    let principalId = "first-principal";
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue({ user: { id: principalId } })}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    );

    const { result, rerender } = renderHook(
      () =>
        useTeamDirectory({
          enabled: true,
          activeAccountId: DEFAULT_ACCOUNT_ID,
          fail,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.directory.kind).toBe("ready"));

    principalId = "second-principal";
    rerender();

    expect(result.current.directory.kind).toBe("loading");
  });

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

    const { result } = renderHook(
      () =>
        useTeamDirectory({
          enabled: true,
          activeAccountId: DEFAULT_ACCOUNT_ID,
          fail,
        }),
      { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> },
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

    const { result } = renderHook(
      () =>
        useTeamDirectory({
          enabled: true,
          activeAccountId: DEFAULT_ACCOUNT_ID,
          fail,
        }),
      { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> },
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

function registerSelfGateDisplayTests(): void {
  it("renders nothing when authMode is off", () => {
    vi.stubGlobal("fetch", mockApi([]));
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider value={authValue({ authMode: "off" })}>
          <MembersSection />
        </AuthContext.Provider>
      </QueryClientProvider>,
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
    // Deliberately malformed (missing required member fields), must not go through rawMember,
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
