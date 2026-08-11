import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emptyAppData, type AppData } from "@capacitylens/shared/types/entities";
import { serializeData } from "@capacitylens/shared/data/transfer";
import { attachPersistence, ReloadDiscardedEditError } from "../data/persist";
import { InMemoryDemoAdapter } from "../data/InMemoryDemoAdapter";
import { useStore } from "../store/useStore";
import { DEFAULT_ACCOUNT_ID, makeAppData, makeResourceDraft, resetStoreWithAccount } from "../test/fixtures";
import { ImportExport } from "./ImportExport";

vi.mock("../data/apiConfig", () => ({
  API_BASE: "",
  isServerConfigured: () => true,
  isDemoMode: () => false,
}));

const TS = "2026-05-01T00:00:00.000Z";

function incomingFile(): File {
  return new File(
    [
      serializeData({
        ...emptyAppData(),
        resources: [
          {
            ...makeResourceDraft({ name: "Imported person" }),
            id: "import-resource",
            accountId: "source-account",
            createdAt: TS,
            updatedAt: TS,
            halfDays: [],
          },
        ],
      }),
    ],
    "incoming.json",
    { type: "application/json" },
  );
}

async function chooseAndConfirmImport(): Promise<void> {
  const input = screen.getByTestId("import-input");
  Object.defineProperty(input, "files", { value: [incomingFile()], configurable: true });
  fireEvent.change(input);
  fireEvent.click(await screen.findByRole("button", { name: "Replace data" }));
}

function importedSlice(): AppData {
  return makeAppData({
    clients: [
      {
        id: "import-client",
        accountId: DEFAULT_ACCOUNT_ID,
        name: "Imported client",
        color: "#2563eb",
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  });
}

describe("ImportExport with the real persistence coordinator", () => {
  let detachPersistence: (() => void) | null = null;
  let adapter: InMemoryDemoAdapter;
  let saveAll: ReturnType<typeof vi.spyOn>;
  let onPersistenceError: Mock<(error: unknown) => void>;

  beforeEach(async () => {
    resetStoreWithAccount();
    adapter = new InMemoryDemoAdapter();
    await adapter.saveAll(structuredClone(useStore.getState().data));
    saveAll = vi.spyOn(adapter, "saveAll");
    onPersistenceError = vi.fn((error: unknown) => {
      useStore.getState().setNotice(error instanceof Error ? error.message : "Persistence failed.", "error");
    });
    detachPersistence = attachPersistence(useStore, adapter, 0, onPersistenceError, undefined, true);
  });

  afterEach(() => {
    detachPersistence?.();
    detachPersistence = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("drops an edit parked during a committed import and surfaces the loss", async () => {
    let finishImport!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishImport = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportExport />);

    await chooseAndConfirmImport();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    useStore.getState().addClient({ name: "Parked during import", color: "#dc2626" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAll).not.toHaveBeenCalled();

    await adapter.saveAll(importedSlice());
    saveAll.mockClear();
    finishImport(
      new Response(JSON.stringify({ imported: 1, skipped: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await waitFor(() =>
      expect(onPersistenceError.mock.calls.some(([error]) => error instanceof ReloadDiscardedEditError)).toBe(true),
    );
    expect(useStore.getState().notice).toMatchObject({
      tone: "error",
      message: expect.stringMatching(/could not be saved/i),
    });
    expect(saveAll).not.toHaveBeenCalled();

    // A later ordinary edit must not smuggle the dropped pre-import edit back into persistence.
    useStore.getState().addClient({ name: "After import", color: "#16a34a" });
    await waitFor(() => expect(saveAll).toHaveBeenCalledOnce());
    const saved = saveAll.mock.calls[0]?.[0] as AppData;
    expect(saved.clients.map((client) => client.name)).toContain("Imported client");
    expect(saved.clients.map((client) => client.name)).toContain("After import");
    expect(saved.clients.map((client) => client.name)).not.toContain("Parked during import");
  });

  it("re-schedules an edit parked during a zero-record import", async () => {
    let finishImport!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishImport = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportExport />);

    await chooseAndConfirmImport();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    useStore.getState().addClient({ name: "Keep after refused import", color: "#16a34a" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAll).not.toHaveBeenCalled();

    finishImport(
      new Response(JSON.stringify({ imported: 0, skipped: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await waitFor(() => expect(saveAll).toHaveBeenCalledOnce());
    const saved = saveAll.mock.calls[0]?.[0] as AppData;
    expect(saved.clients.map((client) => client.name)).toContain("Keep after refused import");
    expect(onPersistenceError.mock.calls.some(([error]) => error instanceof ReloadDiscardedEditError)).toBe(false);
    expect(useStore.getState().notice).toMatchObject({
      tone: "error",
      message: expect.stringMatching(/no records imported/i),
    });
  });
});
