import { emptyAppData } from "@capacitylens/shared/types/entities";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/auth/authContext";
import { useStore } from "@/store/useStore";
import { AccountPicker } from "./AccountPicker";

const serverFlag = vi.hoisted(() => ({ on: false }));
vi.mock("@/data/apiConfig", () => ({
  API_BASE: "",
  isDemoMode: () => !serverFlag.on,
  isServerConfigured: () => serverFlag.on,
}));

vi.mock("@/auth/accountTransition", () => ({
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
