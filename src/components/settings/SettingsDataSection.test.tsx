import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@capacitylens/shared/domain/access";
import { accountClient } from "../../account/accountClient";
import { PermissionContext } from "../../auth/permissionContext";
import { refreshActiveAccountSlice } from "../../data/persist";
import { useStore } from "../../store/useStore";
import {
  DEFAULT_ACCOUNT_ID,
  jsonResponse,
  makeAllocation,
  makeClient,
  makeResource,
  resetStoreWithAccount,
} from "../../test/fixtures";
import { SettingsDataSection } from "./SettingsDataSection";

vi.mock("../../data/persist", () => ({
  refreshActiveAccountSlice: vi.fn(async () => ({ kind: "reloaded" })),
  flushPendingWrites: vi.fn(),
  suspendServerWrites: vi.fn(),
}));

type Props = ComponentProps<typeof SettingsDataSection>;

function renderSection({ role = "owner", serverMode = true }: { role?: Role | null; serverMode?: boolean } = {}) {
  const props = {
    serverMode,
    authMode: "off",
    user: null,
    offlineEnabled: false,
    offlineBusy: false,
    offlineState: {},
    confirmingClear: false,
    setConfirmingClear: vi.fn(),
    clearBusy: false,
    clearLocalStorage: vi.fn(),
    toggleOffline: vi.fn(),
  } as unknown as Props;
  return render(
    <PermissionContext.Provider value={{ role }}>
      <SettingsDataSection {...props} />
    </PermissionContext.Provider>,
  );
}

const owned = { accountId: DEFAULT_ACCOUNT_ID };
const section = () => screen.queryByTestId("settings-example-data");

beforeEach(() => {
  vi.clearAllMocks();
  resetStoreWithAccount();
});
afterEach(() => vi.restoreAllMocks());

describe("Settings example data", () => {
  it("is offered to an admin of an empty company, including one that only holds the Internal client", () => {
    useStore.setState((state) => ({
      data: {
        ...state.data,
        clients: [makeClient({ id: "internal", name: "Internal", builtin: true, accountId: DEFAULT_ACCOUNT_ID })],
      },
    }));
    renderSection({ role: "admin" });
    expect(section()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add example data" })).toBeEnabled();
  });

  it.each([
    ["a person", { resources: [makeResource(owned)] }],
    ["a client", { clients: [makeClient(owned)] }],
    ["an allocation", { resources: [makeResource(owned)], allocations: [makeAllocation(owned)] }],
  ])("is hidden once the company has %s", (_label, rows) => {
    useStore.setState((state) => ({ data: { ...state.data, ...rows } }));
    renderSection();
    expect(section()).not.toBeInTheDocument();
  });

  it("is hidden from an editor and where no server can add it", () => {
    const editor = renderSection({ role: "editor" });
    expect(section()).not.toBeInTheDocument();
    editor.unmount();
    renderSection({ serverMode: false });
    expect(section()).not.toBeInTheDocument();
  });

  it("adds the data, reloads the company and confirms", async () => {
    const add = vi.spyOn(accountClient, "addExampleData").mockResolvedValue(jsonResponse({ added: 15 }, 201));
    renderSection();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add example data" }));
    await waitFor(() => expect(useStore.getState().notice?.message).toBe("Example data added."));
    expect(add).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
    expect(refreshActiveAccountSlice).toHaveBeenCalledWith(DEFAULT_ACCOUNT_ID);
  });

  it("surfaces the server's refusal and does not reload", async () => {
    vi.spyOn(accountClient, "addExampleData").mockResolvedValue(
      jsonResponse({ error: "Example data can only be added to an empty company." }, 409),
    );
    renderSection();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add example data" }));
    await waitFor(() =>
      expect(useStore.getState().notice).toMatchObject({
        tone: "error",
        message: "Example data can only be added to an empty company.",
      }),
    );
    expect(refreshActiveAccountSlice).not.toHaveBeenCalled();
  });
});
