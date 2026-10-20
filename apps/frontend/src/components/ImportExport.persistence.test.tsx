import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppData } from "@capacitylens/shared/types/entities";
import { serializeData } from "@capacitylens/shared/data/transfer";
import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { persistenceCoordinator } from "@/data/persistence/coordinator";
import { useStore } from "@/store/useStore";
import { DEFAULT_ACCOUNT_ID, makeAppData, resetStoreWithAccount } from "@/test/fixtures";
import { ImportExport } from "./ImportExport";
import { useServerImport } from "./import-export/useServerImport";

vi.mock("@/data/apiConfig", () => ({
  API_BASE: "",
  isServerConfigured: () => true,
  isDemoMode: () => false,
}));

const TS = "2026-05-01T00:00:00.000Z";

function incomingFile(): File {
  return new File([serializeData(importedSlice())], "incoming.json", { type: "application/json" });
}

function importedSlice(): AppData {
  return makeAppData({
    clients: [
      {
        ...NULLABLE_FIELDS.clients,
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

async function chooseAndConfirmImport(): Promise<void> {
  const input = screen.getByTestId("import-input");
  Object.defineProperty(input, "files", { value: [incomingFile()], configurable: true });
  fireEvent.change(input);
  fireEvent.click(await screen.findByRole("button", { name: "Replace data" }));
}

function RepeatedConfirmationHarness() {
  const { confirm } = useServerImport();
  return (
    <button
      onClick={() => {
        void confirm(importedSlice());
        void confirm(importedSlice());
      }}
    >
      Confirm twice
    </button>
  );
}

let detachCoordinator: (() => void) | null = null;
let coordination: string[];

beforeEach(() => {
  resetStoreWithAccount();
  coordination = [];
  detachCoordinator = persistenceCoordinator.attach({
    hasUnsavedWrites: () => false,
    flushPending: async () => {
      coordination.push("flush");
      return { kind: "clean" };
    },
    suspendWrites: () => {
      coordination.push("suspend");
      return () => coordination.push("resume");
    },
    refreshActive: async (accountId) => {
      coordination.push(`refresh:${accountId}`);
      useStore.getState().replaceAll(importedSlice());
      return { kind: "reloaded" };
    },
  });
});

afterEach(() => {
  detachCoordinator?.();
  detachCoordinator = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("server import coordination", () => {
  it("starts only one import for repeated immediate confirmation and coordinates its committed refresh", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ imported: 1, skipped: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<RepeatedConfirmationHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm twice" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await waitFor(() => expect(coordination).toEqual(["flush", "suspend", `refresh:${DEFAULT_ACCOUNT_ID}`, "resume"]));

    expect(useStore.getState().data.clients.map((client) => client.name)).toContain("Imported client");
  });

  it("refreshes only after the confirmed import response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ imported: 1, skipped: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportExport />);

    await chooseAndConfirmImport();
    await waitFor(() => expect(coordination).toEqual(["flush", "suspend", `refresh:${DEFAULT_ACCOUNT_ID}`, "resume"]));
    expect(useStore.getState().notice?.tone).toBe("info");
  });
});
