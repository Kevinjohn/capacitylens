import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { BetaExportDocument } from "@capacitylens/shared/data/betaTransfer";
import { attachPersistence, ReloadDiscardedEditError } from "@/data/persist";
import { InMemoryDemoAdapter } from "@/data/InMemoryDemoAdapter";
import { useStore } from "@/store/useStore";
import { DEFAULT_ACCOUNT_ID, makeAppData, resetStoreWithAccount } from "@/test/fixtures";
import { useServerImport } from "./import-export/useServerImport";

vi.mock("@/data/apiConfig", () => ({
  API_BASE: "",
  isServerConfigured: () => true,
  isDemoMode: () => false,
}));

const TS = "2026-05-01T00:00:00.000Z";

async function chooseAndConfirmImport(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Confirm twice" }));
}

function RepeatedConfirmationHarness() {
  const { confirm } = useServerImport();
  return (
    <button
      onClick={() => {
        const document: BetaExportDocument = {
          format: "capacitylens-beta",
          schemaVersion: 1,
          completeness: "full",
          data: importedSlice(),
        };
        void confirm(document, 1, "proof-1");
        void confirm(document, 1, "proof-1");
      }}
    >
      Confirm twice
    </button>
  );
}

function importedSlice(): AppData {
  return makeAppData({
    clients: [
      {
        ...NULLABLE_FIELDS.clients,
        id: "import-client",
        accountId: DEFAULT_ACCOUNT_ID,
        name: "Imported client",
        color: "#2d75da",
        createdAt: TS,
        updatedAt: TS,
      },
    ],
  });
}

function publishParkedClient(name: string): void {
  useStore.setState((state) => ({
    data: {
      ...state.data,
      clients: [
        ...state.data.clients,
        {
          ...NULLABLE_FIELDS.clients,
          id: `client-${name.replaceAll(" ", "-")}`,
          accountId: DEFAULT_ACCOUNT_ID,
          name,
          color: "#16a34a",
          createdAt: TS,
          updatedAt: TS,
        },
      ],
    },
  }));
}

function stringMatching(pattern: RegExp): unknown {
  return expect.stringMatching(pattern);
}

function savedData(saveAll: Mock<(data: AppData) => Promise<void>>): AppData {
  const saved = saveAll.mock.calls[0]?.[0];
  if (saved === undefined) {
    throw new Error("Expected persistence to save data.");
  }
  return saved;
}

let detachPersistence: (() => void) | null = null;
let adapter: InMemoryDemoAdapter;
let saveAll: Mock<(data: AppData) => Promise<void>>;
let onPersistenceError: Mock<(error: unknown) => void>;

beforeEach(async () => {
  await resetStoreWithAccount();
  adapter = new InMemoryDemoAdapter();
  await adapter.saveAll(structuredClone(useStore.getState().data));
  saveAll = vi.spyOn(adapter, "saveAll");
  onPersistenceError = vi.fn((error: unknown) => {
    useStore.getState().setNotice(error instanceof Error ? error.message : "Persistence failed.", "error");
  });
  detachPersistence = attachPersistence({
    store: useStore,
    adapter: adapter,
    debounceMs: 0,
    onError: onPersistenceError,
    serverMode: true,
  });
});

afterEach(() => {
  detachPersistence?.();
  detachPersistence = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function dropsParkedEditDuringCommittedImport(): Promise<void> {
  let finishImport!: (response: Response) => void;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finishImport = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<RepeatedConfirmationHarness />);

  await chooseAndConfirmImport();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

  publishParkedClient("Parked during import");
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
    message: stringMatching(/could not be saved/i),
  });
  expect(saveAll).not.toHaveBeenCalled();

  // A later ordinary edit must not smuggle the dropped pre-import edit back into persistence.
  publishParkedClient("After import");
  await waitFor(() => expect(saveAll).toHaveBeenCalledOnce());
  const saved = savedData(saveAll);
  expect(saved.clients.map((client) => client.name)).toContain("Imported client");
  expect(saved.clients.map((client) => client.name)).toContain("After import");
  expect(saved.clients.map((client) => client.name)).not.toContain("Parked during import");
}

async function reschedulesParkedEditDuringUnchangedImport(): Promise<void> {
  let finishImport!: (response: Response) => void;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finishImport = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<RepeatedConfirmationHarness />);

  await chooseAndConfirmImport();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

  publishParkedClient("Keep after unchanged import");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(saveAll).not.toHaveBeenCalled();

  finishImport(
    new Response(JSON.stringify({ imported: 1, changed: false, revision: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

  await waitFor(() => expect(saveAll).toHaveBeenCalledOnce());
  const saved = savedData(saveAll);
  expect(saved.clients.map((client) => client.name)).toContain("Keep after unchanged import");
  expect(onPersistenceError.mock.calls.some(([error]) => error instanceof ReloadDiscardedEditError)).toBe(false);
  expect(useStore.getState().notice).toMatchObject({ message: stringMatching(/Import complete/i) });
}

describe("ImportExport with the real persistence coordinator", () => {
  it("starts only one server import for repeated immediate confirmation", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);
    render(<RepeatedConfirmationHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm twice" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    publishParkedClient("Parked during import");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAll).not.toHaveBeenCalled();
  });

  it("drops an edit parked during a committed import and surfaces the loss", async () => {
    await dropsParkedEditDuringCommittedImport();
  });

  it("re-schedules an edit parked during an unchanged import", async () => {
    await reschedulesParkedEditDuringUnchangedImport();
  });
});
