import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../../auth/authContext";
import { setOfflineReadState } from "../../data/offlineCache";
import { resetStoreWithAccount } from "../../test/fixtures";
import { MembersSection } from "./MembersSection";
import { authValue, mockApi } from "./MembersSection.testSupport";

vi.mock("../../data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => true }));

const workforce = { id: "workforce", label: "Workforce SSO", kind: "oidc", experimental: false } as const;
const partner = { id: "partner", label: "Partner SSO", kind: "oidc", experimental: false } as const;

beforeEach(() => {
  resetStoreWithAccount();
  setOfflineReadState("cleanup", false);
});

afterEach(() => {
  setOfflineReadState("cleanup", false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Team & access readiness decoupling", () => {
  it("does not fetch or render readiness", async () => {
    const fetchMock = mockApi([{ userId: "me", role: "owner", isSelf: true }]);
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthContext.Provider value={authValue({ providers: [workforce] })}>
        <MembersSection />
      </AuthContext.Provider>,
    );
    await screen.findByTestId("members-section");
    expect(screen.queryByTestId("sso-readiness-section")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/sso-readiness"))).toBe(false);
  });

  it("preserves the invitation draft when the configured SSO provider changes", async () => {
    vi.stubGlobal("fetch", mockApi([{ userId: "me", role: "owner", isSelf: true }]));
    const user = userEvent.setup();
    const view = render(
      <AuthContext.Provider value={authValue({ providers: [workforce] })}>
        <MembersSection />
      </AuthContext.Provider>,
    );
    await user.click(await screen.findByTestId("invite-open"));
    await user.type(screen.getByTestId("invite-preauth"), "draft@example.com");
    fireEvent.keyDown(screen.getByTestId("invite-role"), { key: "ArrowDown" });
    await user.click(screen.getByRole("option", { name: "Viewer" }));

    view.rerender(
      <AuthContext.Provider value={authValue({ providers: [partner] })}>
        <MembersSection />
      </AuthContext.Provider>,
    );

    expect(screen.getByTestId("invite-preauth")).toHaveValue("draft@example.com");
    expect(screen.getByTestId("invite-role")).toHaveTextContent("Viewer");
  });
});
