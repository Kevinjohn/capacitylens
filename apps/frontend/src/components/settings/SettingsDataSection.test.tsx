import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@capacitylens/shared/domain/access";
import { accountClient } from "@/account/accountClient";
import { PermissionContext } from "@/auth/permissionContext";
import { refreshActiveAccountSlice } from "@/data/persist";
import { flushPendingWrites, suspendServerWrites } from "@/data/persist";
import { apiFetch } from "@/data/requestTimeout";
import { reloadPage } from "@/lib/reloadPage";
import { useStore } from "@/store/useStore";
import {
  DEFAULT_ACCOUNT_ID,
  jsonResponse,
  makeAllocation,
  makeClient,
  makeResource,
  resetStoreWithAccount,
} from "@/test/fixtures";
import { SettingsDataSection } from "./SettingsDataSection";

vi.mock("@/data/persist", () => ({
  refreshActiveAccountSlice: vi.fn(async () => ({ kind: "reloaded" })),
  flushPendingWrites: vi.fn(async () => ({ kind: "clean" })),
  suspendServerWrites: vi.fn(() => vi.fn()),
}));
vi.mock("@/data/requestTimeout", () => ({ apiFetch: vi.fn(), API_BULK_TIMEOUT_MS: 30000 }));
vi.mock("@/lib/reloadPage", () => ({ reloadPage: vi.fn() }));
vi.mock("@/auth/ActionProofDialog", () => ({
  ActionProofDialog: ({
    onConfirmed,
    onProviderStart,
  }: {
    onConfirmed: (id: string) => void;
    onProviderStart: (id: string) => void;
  }) => (
    <>
      <button type="button" onClick={() => onConfirmed("proof-one")}>
        Confirm identity
      </button>
      <button type="button" onClick={() => onProviderStart("provider-proof")}>
        Continue with Google
      </button>
    </>
  ),
}));

type Props = ComponentProps<typeof SettingsDataSection>;

function renderSection({ role = "owner", serverMode = true }: { role?: Role | null; serverMode?: boolean } = {}) {
  const props = {
    serverMode,
    confirmingClear: false,
    setConfirmingClear: vi.fn(),
    clearBusy: false,
    clearLocalStorage: vi.fn(),
  } as unknown as Props;
  return render(
    <PermissionContext.Provider value={{ role }}>
      <SettingsDataSection {...props} />
    </PermissionContext.Provider>,
  );
}

const owned = { accountId: DEFAULT_ACCOUNT_ID };
const section = () => screen.queryByTestId("settings-example-data");

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  await resetStoreWithAccount();
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

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

describe("Whole-company anonymisation", () => {
  it("offers the server action to an Owner, but not an Admin or Editor", () => {
    const owner = renderSection({ role: "owner" });
    expect(screen.getByTestId("settings-company-anonymise")).toBeInTheDocument();
    owner.unmount();
    const admin = renderSection({ role: "admin" });
    expect(screen.queryByTestId("settings-company-anonymise")).not.toBeInTheDocument();
    admin.unmount();
    renderSection({ role: "editor" });
    expect(screen.queryByTestId("settings-company-anonymise")).not.toBeInTheDocument();
  });

  it("scrubs only the selected company's demo resources in one volatile replacement", async () => {
    const resource = makeResource({ id: "r-private", accountId: DEFAULT_ACCOUNT_ID, name: "Bruce Wayne" });
    const foreign = makeResource({ id: "r-foreign", accountId: "a-loft", name: "Tony Stark" });
    const allocation = makeAllocation({
      id: "al-private",
      accountId: DEFAULT_ACCOUNT_ID,
      resourceId: resource.id,
      note: "Private note",
    });
    const foreignAllocation = makeAllocation({
      id: "al-foreign",
      accountId: "a-loft",
      resourceId: foreign.id,
      note: "Foreign note",
    });
    useStore.setState((state) => ({
      data: { ...state.data, resources: [resource, foreign], allocations: [allocation, foreignAllocation] },
    }));
    renderSection({ serverMode: false });
    await userEvent.setup().click(screen.getByRole("button", { name: "Anonymise all resources" }));
    const observed: string[] = [];
    const unsubscribe = useStore.subscribe((state) => {
      observed.push(state.data.resources.find((row) => row.id === resource.id)?.name ?? "missing");
    });
    await userEvent
      .setup()
      .click(within(screen.getByRole("dialog")).getByRole("button", { name: "Anonymise all resources" }));
    const data = useStore.getState().data;
    expect(data.resources.find((row) => row.id === resource.id)?.name).toMatch(/^Removed person/);
    expect(data.resources.find((row) => row.id === foreign.id)).toEqual(foreign);
    expect(data.allocations.find((row) => row.id === foreignAllocation.id)).toEqual(foreignAllocation);
    expect(data.allocations.find((row) => row.id === allocation.id)?.note).toBeNull();
    expect(useStore.getState().past).toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((name) => name.startsWith("Removed person"))).toBe(true);
    unsubscribe();
  });

  it("invalidates a deleted booking's restoration handle and Undo after the demo scrub", async () => {
    const resource = makeResource({ id: "r-private", accountId: DEFAULT_ACCOUNT_ID });
    const allocation = makeAllocation({
      id: "al-private",
      accountId: DEFAULT_ACCOUNT_ID,
      resourceId: resource.id,
      note: "Private note",
    });
    useStore.setState((state) => ({
      data: { ...state.data, resources: [resource], allocations: [allocation] },
    }));
    await useStore.getState().deleteAllocation(allocation.id);
    expect(useStore.getState().planning.history.past.length).toBeGreaterThan(0);
    renderSection({ serverMode: false });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anonymise all resources" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Anonymise all resources" }));
    expect(useStore.getState().planning.history.past).toEqual([]);
    await useStore.getState().undoPlanning();
    expect(useStore.getState().data.allocations).toEqual([]);
  });

  it("sends a bound proof to the named server endpoint after pending writes settle", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }));
    renderSection({ role: "owner" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anonymise all resources" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Anonymise all resources" }));
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledOnce());
    expect(flushPendingWrites).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/api/accounts/${DEFAULT_ACCOUNT_ID}/anonymise$`)),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ proofId: "proof-one" }) }),
      expect.any(Number),
    );
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it("does not dispatch after the selected company changes during pending-write flush", async () => {
    let finishFlush!: (value: { kind: "clean" }) => void;
    vi.mocked(flushPendingWrites).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFlush = resolve;
        }),
    );
    renderSection({ role: "owner" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anonymise all resources" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Anonymise all resources" }));
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    expect(flushPendingWrites).toHaveBeenCalledOnce();
    useStore.setState({ activeAccountId: "a-loft" });
    finishFlush({ kind: "clean" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalled();
    expect(suspendServerWrites).not.toHaveBeenCalled();
    useStore.setState({ activeAccountId: DEFAULT_ACCOUNT_ID });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([408, 500])("keeps writes suspended after an uncertain HTTP %s", async (status) => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status }));
    renderSection({ role: "owner" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anonymise all resources" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Anonymise all resources" }));
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument());
    const resume = vi.mocked(suspendServerWrites).mock.results[0]?.value as ReturnType<typeof suspendServerWrites>;
    expect(resume).not.toHaveBeenCalled();
  });

  it("keeps writes suspended after a lost response", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("Connection lost"));
    renderSection({ role: "owner" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anonymise all resources" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Anonymise all resources" }));
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument());
    const resume = vi.mocked(suspendServerWrites).mock.results[0]?.value as ReturnType<typeof suspendServerWrites>;
    expect(resume).not.toHaveBeenCalled();
  });

  it("stores only the opaque provider proof before leaving, without submitting", async () => {
    renderSection({ role: "owner" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anonymise all resources" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Anonymise all resources" }));
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(JSON.parse(sessionStorage.getItem("capacitylens/company-anonymise-action-proof") ?? "null")).toEqual({
      accountId: DEFAULT_ACCOUNT_ID,
      proofId: "provider-proof",
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("resumes a same-company provider proof only after another explicit click", async () => {
    sessionStorage.setItem(
      "capacitylens/company-anonymise-action-proof",
      JSON.stringify({ accountId: DEFAULT_ACCOUNT_ID, proofId: "provider-proof" }),
    );
    window.history.replaceState(null, "", "/?capacitylensActionConfirmed=1");
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }));
    renderSection({ role: "owner" });
    const dialog = await screen.findByRole("dialog", { name: "Anonymise all company resources?" });
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Anonymise all resources" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledOnce());
    expect(apiFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ proofId: "provider-proof" }) }),
      expect.any(Number),
    );
  });

  it("clears a pending provider continuation when the selected company changes", async () => {
    sessionStorage.setItem(
      "capacitylens/company-anonymise-action-proof",
      JSON.stringify({ accountId: DEFAULT_ACCOUNT_ID, proofId: "provider-proof" }),
    );
    window.history.replaceState(null, "", "/?capacitylensActionConfirmed=1");
    renderSection({ role: "owner" });
    await screen.findByRole("dialog", { name: "Anonymise all company resources?" });
    useStore.setState({ activeAccountId: "a-loft" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    useStore.setState({ activeAccountId: DEFAULT_ACCOUNT_ID });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("discards wrong-company provider proof and a cancelled continuation", async () => {
    sessionStorage.setItem(
      "capacitylens/company-anonymise-action-proof",
      JSON.stringify({ accountId: "a-loft", proofId: "foreign-proof" }),
    );
    window.history.replaceState(null, "", "/?capacitylensActionConfirmed=1");
    const wrong = renderSection({ role: "owner" });
    await waitFor(() => expect(sessionStorage.getItem("capacitylens/company-anonymise-action-proof")).toBeNull());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    wrong.unmount();

    sessionStorage.setItem(
      "capacitylens/company-anonymise-action-proof",
      JSON.stringify({ accountId: DEFAULT_ACCOUNT_ID, proofId: "provider-proof" }),
    );
    window.history.replaceState(null, "", "/?capacitylensActionConfirmed=1");
    renderSection({ role: "owner" });
    const dialog = await screen.findByRole("dialog", { name: "Anonymise all company resources?" });
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("releases suspended writes after a definitive refusal", async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 }));
    renderSection({ role: "owner" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anonymise all resources" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Anonymise all resources" }));
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    await waitFor(() => expect(useStore.getState().notice?.message).toBe("Forbidden."));
    const resume = vi.mocked(suspendServerWrites).mock.results[0]?.value as ReturnType<typeof suspendServerWrites>;
    expect(resume).toHaveBeenCalledOnce();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
