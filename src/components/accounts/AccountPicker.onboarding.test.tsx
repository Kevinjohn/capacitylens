import { emptyAppData } from "@capacitylens/shared/types/entities";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "../../auth/authContext";
import { useStore } from "../../store/useStore";
import { AccountPicker } from "./AccountPicker";

const serverFlag = vi.hoisted(() => ({ on: false }));
vi.mock("../../data/apiConfig", () => ({
  API_BASE: "",
  isDemoMode: () => !serverFlag.on,
  isServerConfigured: () => serverFlag.on,
}));

vi.mock("../../auth/accountTransition", () => ({
  transitionAccount: vi.fn(async (id: string | null) => {
    useStore.getState().setActiveAccount(id);
    return true;
  }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  serverFlag.on = false;
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().setActiveAccount(null);
  useStore.getState().setAccountSummaries({ list: [] });
  useStore.getState().setNotice(null);
});

function renderWithoutCreatePermission() {
  return render(
    <AuthContext.Provider
      value={{
        authMode: "off",
        user: null,
        canCreateAccount: false,
        multiAccount: false,
        refreshAuth: async () => {},
        signOut: async () => {},
      }}
    >
      <AccountPicker />
    </AuthContext.Provider>,
  );
}

describe("AccountPicker first-company onboarding", () => {
  it("continues first-owner setup with company creation only", () => {
    render(<AccountPicker />);

    expect(screen.getByRole("heading", { name: "Set up your company" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Set up your company" })).toHaveClass("sr-only");
    expect(screen.getByText("Create your company to start planning.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "New company" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveFocus();
    expect(screen.queryByText("Ask an admin for an invite to join an existing company.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("company-empty-options")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-company-button")).not.toBeInTheDocument();
  });

  it("shows only the invite step when the user cannot create a company", () => {
    renderWithoutCreatePermission();

    expect(screen.getByRole("heading", { name: "Start planning" })).toBeInTheDocument();
    expect(screen.getByText("Ask an admin for an invite to join a company.")).toBeInTheDocument();
    expect(screen.getByText("Ask an admin for an invite to join an existing company.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-company-button")).not.toBeInTheDocument();
  });

  it("does not infer setup eligibility from an unavailable company directory", () => {
    useStore
      .getState()
      .setAccountSummaries({ list: [], requestId: useStore.getState().accountSummariesRequestId, complete: false });
    render(<AccountPicker />);

    expect(screen.getByRole("heading", { name: "Start planning" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Set up your company" })).not.toBeInTheDocument();
    expect(screen.getByText("Ask an admin for an invite to join an existing company.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Company name")).not.toBeInTheDocument();
  });

  it("does not ask first-company users to choose a colour", () => {
    render(<AccountPicker />);
    expect(screen.queryByText("Colour")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Colour \(/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("does not offer example data where no server can add it", () => {
    render(<AccountPicker />);
    expect(screen.queryByRole("checkbox", { name: "Start with example data" })).not.toBeInTheDocument();
  });
});

describe("AccountPicker example data", () => {
  const sent: string[] = [];
  function stubServer(exampleDataStatus: number, exampleDataError?: string) {
    sent.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        sent.push(url);
        if (url === "/api/orgs") return { ok: true, status: 201, json: async () => ({ id: "org-1", name: "Wayne" }) };
        return {
          ok: exampleDataStatus < 400,
          status: exampleDataStatus,
          json: async () => (exampleDataError ? { error: exampleDataError } : {}),
        };
      }),
    );
  }

  it("is ticked by default for a first company and unticked once a company exists", async () => {
    serverFlag.on = true;
    const { unmount } = render(<AccountPicker />);
    expect(screen.getByRole("checkbox", { name: "Start with example data" })).toBeChecked();
    unmount();

    useStore.getState().setAccountSummaries({ list: [{ id: "a1", name: "Wayne", role: "owner" }] });
    render(
      <AuthContext.Provider
        value={{
          authMode: "off",
          user: null,
          canCreateAccount: true,
          multiAccount: true,
          refreshAuth: async () => {},
          signOut: async () => {},
        }}
      >
        <AccountPicker />
      </AuthContext.Provider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId("new-company-button"));
    expect(screen.getByRole("checkbox", { name: "Start with example data" })).not.toBeChecked();
  });

  it("adds example data after creating the company when the box is ticked", async () => {
    serverFlag.on = true;
    stubServer(201);
    const user = userEvent.setup();
    render(<AccountPicker />);
    await user.type(screen.getByLabelText("Company name"), "Wayne Enterprises");
    await user.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(useStore.getState().activeAccountId).toBe("org-1"));
    expect(sent).toEqual(["/api/orgs", "/api/accounts/org-1/example-data"]);
  });

  it("adds nothing when the box is unticked", async () => {
    serverFlag.on = true;
    stubServer(201);
    const user = userEvent.setup();
    render(<AccountPicker />);
    await user.type(screen.getByLabelText("Company name"), "Wayne Enterprises");
    await user.click(screen.getByRole("checkbox", { name: "Start with example data" }));
    await user.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(useStore.getState().activeAccountId).toBe("org-1"));
    expect(sent).toEqual(["/api/orgs"]);
  });

  it("keeps the new company and says so when the example data cannot be added", async () => {
    serverFlag.on = true;
    stubServer(500, "The example data failed.");
    const user = userEvent.setup();
    render(<AccountPicker />);
    await user.type(screen.getByLabelText("Company name"), "Wayne Enterprises");
    await user.click(screen.getByRole("button", { name: "Create company" }));
    await waitFor(() => expect(useStore.getState().activeAccountId).toBe("org-1"));
    expect(useStore.getState().notice).toMatchObject({
      tone: "error",
      message: expect.stringContaining("The example data failed.") as string,
    });
  });
});
