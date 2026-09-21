import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../../auth/authContext";
import { PermissionContext, type PermissionContextValue } from "../../auth/permissionContext";
import { setOfflineReadState } from "../../data/offlineCache";
import { DEFAULT_ACCOUNT_ID, jsonResponse, resetStoreWithAccount } from "../../test/fixtures";
import { useStore } from "../../store/useStore";
import { authValue, mockApi, rawMember, stubPageReload } from "@/components/team/MembersSection.testSupport";
import { SettingsSsoReadinessSection } from "./SettingsSsoReadinessSection";
import { m } from "@/i18n";

vi.mock("../../data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => true }));

const workforce = { id: "workforce", label: "Workforce SSO", kind: "oidc", experimental: false } as const;
const partner = { id: "partner", label: "Partner SSO", kind: "oidc", experimental: false } as const;
const directory = [
  { userId: "me", role: "owner" as const, isSelf: true },
  { userId: "target", role: "admin" as const, isSelf: false },
];

function readiness({
  provider = workforce,
  principalId = "target",
  displayName = principalId === "me" ? "Lucius Fox" : "Alfred Pennyworth",
  linked = false,
  reason = "member_not_linked",
}: {
  provider?: typeof workforce | typeof partner;
  principalId?: string;
  displayName?: string;
  linked?: boolean;
  reason?: string;
} = {}) {
  return {
    ready: false,
    provider,
    members: [
      {
        principalId,
        email: `${principalId}@x.io`,
        displayName,
        role: principalId === "me" ? "owner" : "admin",
        linked,
        blocking: true,
        critical: true,
        reason,
        repairLinks: linked ? [{ rowId: "link-1", providerId: provider.id, subject: "subject-1" }] : [],
      },
    ],
    issues: [],
    globalIssues: [],
  };
}

function renderReadiness({
  auth = {},
  permission = { role: "owner", status: "resolved" },
}: {
  auth?: Partial<AuthContextValue>;
  permission?: PermissionContextValue;
} = {}) {
  const ui = (nextAuth: Partial<AuthContextValue> = auth, nextPermission: PermissionContextValue = permission) => (
    <PermissionContext.Provider value={nextPermission}>
      <AuthContext.Provider value={authValue({ providers: [workforce], ...nextAuth })}>
        <SettingsSsoReadinessSection />
      </AuthContext.Provider>
    </PermissionContext.Provider>
  );
  const view = render(ui());
  return {
    ...view,
    rerenderWith: (nextAuth: Partial<AuthContextValue>, nextPermission = permission) =>
      view.rerender(ui(nextAuth, nextPermission)),
  };
}

beforeEach(() => {
  resetStoreWithAccount();
  setOfflineReadState("cleanup", false);
});

afterEach(() => {
  setOfflineReadState("cleanup", false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Settings SSO readiness boundary", () => {
  it.each(["editor", "viewer"] as const)("does not read readiness for a %s", async (role) => {
    const fetchMock = mockApi(directory);
    vi.stubGlobal("fetch", fetchMock);
    renderReadiness({ permission: { role, status: "resolved" } });
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps loading quiet, then renders the authorized readiness response", async () => {
    let resolveReadiness!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveReadiness = resolve;
    });
    vi.stubGlobal("fetch", mockApi(directory, { "GET /sso-readiness": () => pending }));
    renderReadiness();
    await screen.findByTestId("sso-readiness-section");
    expect(screen.queryByTestId("sso-readiness")).not.toBeInTheDocument();
    await act(async () => resolveReadiness(jsonResponse(readiness())));
    expect(await screen.findByTestId("sso-readiness")).toBeInTheDocument();
  });

  it("renders readiness as its own Settings group and member table", async () => {
    let resolveReadiness!: (response: Response) => void;
    const pendingReadiness = new Promise<Response>((resolve) => {
      resolveReadiness = resolve;
    });
    vi.stubGlobal("fetch", mockApi(directory, { "GET /sso-readiness": () => pendingReadiness }));
    renderReadiness();

    const group = await screen.findByRole("region", { name: m.settings_sso_readiness_heading() });
    await act(async () => resolveReadiness(jsonResponse(readiness())));
    const table = await within(group).findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Member", "Role", "Status", "Actions"]);
    expect(within(table).getByText("target@x.io")).toBeInTheDocument();
  });

  it.each([
    ["failed", () => jsonResponse({ error: "Unavailable" }, 503)],
    [
      "malformed",
      () =>
        jsonResponse({
          ...readiness({ linked: true }),
          members: [
            {
              ...readiness({ linked: true }).members[0],
              repairLinks: [{ rowId: "link-1", providerId: "workforce", subject: "" }],
            },
          ],
        }),
    ],
  ])("keeps a %s readiness response visibly failed", async (_case, response) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", mockApi(directory, { "GET /sso-readiness": response }));
    renderReadiness();
    expect(await screen.findByTestId("sso-readiness-error")).toHaveTextContent(m.settings_sso_readiness_error());
  });

  it("does not fetch while offline and fetches on recovery", async () => {
    const fetchMock = mockApi(directory, { "GET /sso-readiness": () => jsonResponse(readiness()) });
    vi.stubGlobal("fetch", fetchMock);
    setOfflineReadState("tenant", true, Date.now());
    renderReadiness();
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => setOfflineReadState("cleanup", false));
    expect(await screen.findByTestId("sso-readiness")).toBeInTheDocument();
  });

  it("refreshes for an active-account change", async () => {
    const nextAccountId = "22222222-2222-4222-8222-222222222222";
    let resolveNextReadiness!: (response: Response) => void;
    const nextReadiness = new Promise<Response>((resolve) => {
      resolveNextReadiness = resolve;
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/members")) {
        const members = url.includes(`/accounts/${nextAccountId}/`)
          ? [
              rawMember({ userId: "me", role: "owner", isSelf: true }),
              rawMember({ userId: "diana", role: "admin", name: "Diana Prince" }),
            ]
          : directory.map((member) => rawMember(member));
        return jsonResponse({ members, resourceCandidates: [] });
      }
      if (url.endsWith("/invites")) return jsonResponse({ invites: [] });
      if (url.endsWith("/sso-readiness"))
        return url.includes(`/accounts/${nextAccountId}/`) ? nextReadiness : jsonResponse(readiness());
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderReadiness();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("sso-correct-email"));
    expect(screen.getByTestId("sso-correct-email-input")).toBeInTheDocument();
    act(() => useStore.setState({ activeAccountId: nextAccountId }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes(`/accounts/${nextAccountId}/sso-readiness`)),
      ).toBe(true),
    );
    expect(screen.queryByTestId("sso-correct-email-input")).not.toBeInTheDocument();
    expect(screen.queryByText("Alfred Pennyworth")).not.toBeInTheDocument();
    await act(async () =>
      resolveNextReadiness(jsonResponse(readiness({ principalId: "diana", displayName: "Diana Prince" }))),
    );
    expect(await screen.findByText(/diana@x\.io/)).toBeInTheDocument();
  });

  it("shows a directory failure and retries it without hiding the section", async () => {
    let memberReads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /members": () =>
          ++memberReads === 1
            ? jsonResponse({ error: "Unavailable" }, 503)
            : jsonResponse({ members: directory.map((member) => rawMember(member)), resourceCandidates: [] }),
        "GET /sso-readiness": () => jsonResponse(readiness()),
      }),
    );
    renderReadiness();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("sso-readiness")).toBeInTheDocument();
    expect(memberReads).toBe(2);
  });

  it("clears repair state while a changed provider readiness response is pending", async () => {
    let resolvePartner!: (response: Response) => void;
    const partnerRequest = new Promise<Response>((resolve) => {
      resolvePartner = resolve;
    });
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => (++reads === 1 ? jsonResponse(readiness()) : partnerRequest),
      }),
    );
    const view = renderReadiness();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("sso-correct-email"));
    expect(screen.getByTestId("sso-correct-email-input")).toBeInTheDocument();
    view.rerenderWith({ providers: [partner] });
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.queryByTestId("sso-correct-email-input")).not.toBeInTheDocument();
    expect(screen.queryByText(/Workforce SSO/)).not.toBeInTheDocument();
    await act(async () => resolvePartner(jsonResponse(readiness({ provider: partner }))));
    expect(await screen.findByText(/Partner SSO/)).toBeInTheDocument();
  });

  it("ignores an obsolete completion after the strict provider changes", async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const oldRequest = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const newRequest = new Promise<Response>((resolve) => {
      resolveNew = resolve;
    });
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(directory, { "GET /sso-readiness": () => (++reads === 1 ? oldRequest : newRequest) }),
    );
    const view = renderReadiness();
    await waitFor(() => expect(reads).toBe(1));
    view.rerenderWith({ providers: [partner] });
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => resolveNew(jsonResponse(readiness({ provider: partner }))));
    expect(await screen.findByText(/Partner SSO/)).toBeInTheDocument();
    await act(async () => resolveOld(jsonResponse(readiness())));
    expect(screen.getByText(/Partner SSO/)).toBeInTheDocument();
    expect(screen.queryByText(/Workforce SSO/)).not.toBeInTheDocument();
  });

  it("corrects email and reconciles both directory and readiness", async () => {
    const user = userEvent.setup();
    let memberReads = 0;
    let readinessReads = 0;
    const fetchMock = mockApi(directory, {
      "GET /members": (url, init) => {
        void url;
        void init;
        memberReads += 1;
        return jsonResponse({ members: directory.map((member) => rawMember(member)), resourceCandidates: [] });
      },
      "GET /sso-readiness": () => {
        readinessReads += 1;
        return jsonResponse(readiness());
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderReadiness();
    await user.click(await screen.findByTestId("sso-correct-email"));
    await user.clear(screen.getByTestId("sso-correct-email-input"));
    await user.type(screen.getByTestId("sso-correct-email-input"), "corrected@example.com");
    await user.click(screen.getByTestId("sso-correct-email-save"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/members/target/email`,
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ email: "corrected@example.com" }) }),
      ),
    );
    await waitFor(() => expect(memberReads).toBeGreaterThan(1));
    await waitFor(() => expect(readinessReads).toBeGreaterThan(1));
  });

  it("shows validation, refusal, and fresh-session repair errors beside the email field", async () => {
    const user = userEvent.setup();
    let correction = 0;
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => jsonResponse(readiness()),
        "PATCH /members/target/email": () =>
          ++correction === 1
            ? jsonResponse({ error: "Email already belongs to another user." }, 409)
            : jsonResponse({ error: "Sign in again to continue." }, 401),
      }),
    );
    renderReadiness();
    await user.click(await screen.findByTestId("sso-correct-email"));
    const input = screen.getByTestId("sso-correct-email-input");
    await user.clear(input);
    await user.type(input, "bad");
    await user.click(screen.getByTestId("sso-correct-email-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(m.identity_err_email());
    await user.clear(input);
    await user.type(input, "corrected@example.com");
    await user.click(screen.getByTestId("sso-correct-email-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email already belongs to another user.");
    await user.click(screen.getByTestId("sso-correct-email-save"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign in again to continue.");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
  });

  it("reloads the page after repairing the current member email", async () => {
    const reload = stubPageReload();
    vi.stubGlobal(
      "fetch",
      mockApi([{ userId: "me", role: "owner", isSelf: true }], {
        "GET /sso-readiness": () => jsonResponse(readiness({ principalId: "me" })),
      }),
    );
    renderReadiness();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("sso-correct-email"));
    await user.clear(screen.getByTestId("sso-correct-email-input"));
    await user.type(screen.getByTestId("sso-correct-email-input"), "corrected@example.com");
    await user.click(screen.getByTestId("sso-correct-email-save"));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it("requires confirmation before unlinking and refreshes readiness after success", async () => {
    const user = userEvent.setup();
    let readinessReads = 0;
    const fetchMock = mockApi(directory, {
      "GET /sso-readiness": () => {
        readinessReads += 1;
        return jsonResponse(readiness({ linked: true, reason: "unverified_provider_link" }));
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    renderReadiness();
    await user.click(await screen.findByTestId("sso-remove-link"));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/target@x\.io/i);
    await user.click(within(dialog).getByRole("button", { name: "Remove incorrect link" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(readinessReads).toBeGreaterThan(1));
  });

  it.each([
    ["refused", () => jsonResponse({ error: "Unlink unavailable." }, 500), "Unlink unavailable."],
    ["transport", () => Promise.reject(new Error("offline")), m.settings_sso_remove_link_error()],
  ])("surfaces a %s unlink error without claiming success", async (_case, response, message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => jsonResponse(readiness({ linked: true, reason: "unverified_provider_link" })),
        "DELETE /members/target/federated-link": response,
      }),
    );
    renderReadiness();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("sso-remove-link"));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove incorrect link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("hides mixed-mode repair actions after password sign-in is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      mockApi(directory, {
        "GET /sso-readiness": () => jsonResponse(readiness({ linked: true, reason: "unverified_provider_link" })),
      }),
    );
    renderReadiness({ auth: { authMode: "sso" } });
    expect(await screen.findByTestId("sso-readiness")).toBeInTheDocument();
    expect(screen.queryByTestId("sso-correct-email")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sso-remove-link")).not.toBeInTheDocument();
  });
});
