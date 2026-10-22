import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildBetaExport, parseBetaExport, serializeBetaExport } from "@capacitylens/shared/data/betaTransfer";
import type { BetaExportDocument } from "@capacitylens/shared/data/betaTransfer";
import { seed } from "@capacitylens/shared/data/seed";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { AuthContext } from "@/auth/authContext";
import { PermissionContext } from "@/auth/permissionContext";
import { useStore } from "@/store/useStore";
import { resetStoreWithAccount } from "@/test/fixtures";
import { ImportExport } from "./ImportExport";

const serverFlag = { on: false };
const refreshOverride = vi.hoisted(() => ({ result: { kind: "reloaded" } as { kind: string } }));
const persistenceProbe = vi.hoisted(() => ({ resumes: [] as Array<{ dropParkedEdits: boolean }>, suspends: 0 }));
vi.mock("@/data/apiConfig", () => ({
  API_BASE: "",
  isServerConfigured: () => serverFlag.on,
  isDemoMode: () => !serverFlag.on,
}));
vi.mock("@/data/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/persist")>()),
  refreshActiveAccountSlice: async () => refreshOverride.result,
  flushPendingWrites: async () => ({ kind: "clean" as const }),
  suspendServerWrites: () => {
    persistenceProbe.suspends += 1;
    return (options: { dropParkedEdits: boolean }) => persistenceProbe.resumes.push(options);
  },
}));

const accountId = "a-studio";

function document(): BetaExportDocument {
  return buildBetaExport(seed(), { accountId, completeness: "full" });
}

function renderTools(server = false, reauthMethod: "password" | "provider" = "password") {
  serverFlag.on = server;
  return render(
    <AuthContext.Provider
      value={{
        authMode: server ? "password-only" : "off",
        user: server ? { id: "bruce", email: "bruce@wayne.example" } : null,
        canCreateAccount: false,
        reauthMethod,
        refreshAuth: async () => {},
        signOut: async () => {},
      }}
    >
      <PermissionContext.Provider value={{ role: server ? "owner" : null, status: "resolved" }}>
        <ImportExport />
      </PermissionContext.Provider>
    </AuthContext.Provider>,
  );
}

async function selectFile(file: BetaExportDocument) {
  const input = screen.getByTestId("import-input");
  Object.defineProperty(input, "files", {
    value: [new File([serializeBetaExport(file)], "transfer.json", { type: "application/json" })],
    configurable: true,
  });
  fireEvent.change(input);
  await screen.findByRole("button", { name: "Continue" });
}

async function previewFile(file: BetaExportDocument) {
  await selectFile(file);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Replace data" });
}

async function submitServerImport(applyResponse: Response): Promise<void> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/api/transfer/preview"))
        return Response.json({ baseRevision: 7, imported: 5, changed: true });
      if (String(url).endsWith("/api/auth/action-proof/password")) return Response.json({ proofId: "proof-7" });
      if (String(url).endsWith("/api/transfer/apply")) return applyResponse;
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
  renderTools(true);
  await previewFile(document());
  fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "current-password" } });
  fireEvent.click(screen.getByTestId("action-proof-confirm"));
  await waitFor(() => expect(persistenceProbe.suspends).toBe(1));
}

beforeEach(async () => {
  serverFlag.on = false;
  refreshOverride.result = { kind: "reloaded" };
  persistenceProbe.suspends = 0;
  persistenceProbe.resumes.length = 0;
  await resetStoreWithAccount(accountId);
  useStore.getState().replaceAll(seed());
  sessionStorage.clear();
  window.history.replaceState(null, "", "/settings");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("beta import and export", () => {
  it("exports the selected company's full beta document", async () => {
    let downloaded: Blob | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        downloaded = blob;
        return "blob:transfer";
      }),
      revokeObjectURL: vi.fn(),
    });
    renderTools();
    fireEvent.click(screen.getByTestId("export-data"));
    await waitFor(() => {
      expect(useStore.getState().notice).toBeNull();
      expect(downloaded).toBeDefined();
    });
    if (!downloaded) throw new Error("The export was not downloaded.");
    const exported = parseBetaExport(await downloaded.text());
    expect(exported.format).toBe("capacitylens-beta");
    expect(exported.completeness).toBe("full");
    expect(exported.data.accounts.map((row) => row.id)).toEqual([accountId]);
    expect(exported.data.resources[0]?.id).toBeDefined();
  });

  it("refuses a malformed inactive server slice instead of downloading a repaired backup", async () => {
    const bad = buildBetaExport(seed(), { accountId, completeness: "full" }).data;
    const client = bad.clients[0];
    if (!client) throw new Error("The export fixture has no client.");
    Object.assign(client, { archivedAt: "yesterday" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(bad)),
    );
    const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderTools(true);
    fireEvent.click(screen.getByTestId("export-data"));
    await waitFor(() => expect(useStore.getState().notice?.tone).toBe("error"));
    expect(download).not.toHaveBeenCalled();
  });

  it("previews without writing, cancels, then replaces only the selected demo company with stable IDs", async () => {
    const before = structuredClone(useStore.getState().data);
    const incoming = document();
    const incomingAccount = incoming.data.accounts[0];
    if (!incomingAccount) throw new Error("The import fixture has no company.");
    incomingAccount.name = "Wayne Enterprises restored";
    renderTools();
    await selectFile(incoming);
    expect(useStore.getState().data).toEqual(before);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useStore.getState().data).toEqual(before);

    await previewFile(incoming);
    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    await waitFor(() =>
      expect(useStore.getState().data.accounts.find((row) => row.id === accountId)?.name).toBe(
        "Wayne Enterprises restored",
      ),
    );
    const after = useStore.getState().data;
    expect(after.accounts.find((row) => row.id === "a-loft")).toEqual(
      before.accounts.find((row) => row.id === "a-loft"),
    );
    for (const key of SCOPED_KEYS)
      expect(after[key].filter((row) => row.accountId === "a-loft")).toEqual(
        before[key].filter((row) => row.accountId === "a-loft"),
      );
    expect(after.resources.filter((row) => row.accountId === accountId).map((row) => row.id)).toEqual(
      incoming.data.resources.map((row) => row.id),
    );
    expect(useStore.getState().past).toEqual([]);
  });

  it("invalidates typed Undo and old restoration handles in the same demo import publication", async () => {
    await useStore.getState().refreshPlanning();
    const allocation = useStore.getState().data.allocations.find((row) => row.accountId === accountId);
    if (!allocation) throw new Error("The demo allocation fixture is missing.");
    await useStore.getState().deleteAllocation(allocation.id);
    const history = useStore.getState().planning.history.past;
    const inverse = history.at(-1)?.inverse;
    if (inverse?.operation !== "planning.restoreGroup") throw new Error("The delete has no restoration handle.");

    const incoming = document();
    incoming.data.allocations = incoming.data.allocations.filter((row) => row.id !== allocation.id);
    const account = incoming.data.accounts[0];
    if (!account) throw new Error("The imported company is missing.");
    account.name = "Wayne Enterprises after import";
    const publications: Array<{ imported: boolean; typedHistory: number }> = [];
    const unsubscribe = useStore.subscribe((state) => {
      publications.push({
        imported: state.data.accounts.some((row) => row.id === accountId && row.name === account.name),
        typedHistory: state.planning.history.past.length,
      });
    });
    try {
      renderTools();
      await previewFile(incoming);
      fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
      await waitFor(() =>
        expect(useStore.getState().data.accounts.find((row) => row.id === accountId)?.name).toBe(account.name),
      );
      expect(
        publications
          .filter((publication) => publication.imported)
          .every((publication) => publication.typedHistory === 0),
      ).toBe(true);
      expect(await useStore.getState().undoPlanning()).toBe(false);
      await expect(useStore.getState().sendPlanningCommand({ intent: inverse, inverse: null })).rejects.toThrow();
      expect(useStore.getState().data.allocations.some((row) => row.id === allocation.id)).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it("refuses a redacted document before showing replacement confirmation", async () => {
    const before = structuredClone(useStore.getState().data);
    const redacted = buildBetaExport(seed(), { accountId, completeness: "redacted" });
    renderTools();
    const input = screen.getByTestId("import-input");
    Object.defineProperty(input, "files", {
      value: [new File([serializeBetaExport(redacted)], "redacted.json", { type: "application/json" })],
      configurable: true,
    });
    fireEvent.change(input);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/full|redacted/i);
    expect(useStore.getState().data).toEqual(before);
  });

  it.each([
    ["invalid JSON", '{ "format":', /valid JSON/i],
    ["unrelated JSON", '{ "hello": "world" }', /beta-native CapacityLens export/i],
    ["unsupported version", JSON.stringify({ ...document(), schemaVersion: 2 }), /unsupported/i],
  ])("refuses %s without changing demo data", async (_case, contents, message) => {
    const before = structuredClone(useStore.getState().data);
    renderTools();
    const input = screen.getByTestId("import-input");
    Object.defineProperty(input, "files", {
      value: [new File([contents], "invalid.json", { type: "application/json" })],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(message));
    expect(screen.queryByRole("button", { name: "Replace data" })).toBeNull();
    expect(useStore.getState().data).toEqual(before);
  });

  it("refuses a full document with a name over the beta field limit", async () => {
    const before = structuredClone(useStore.getState().data);
    const oversized = document();
    const oversizedAccount = oversized.data.accounts[0];
    if (!oversizedAccount) throw new Error("The import fixture has no company.");
    oversizedAccount.name = "W".repeat(1000);
    renderTools();
    const input = screen.getByTestId("import-input");
    Object.defineProperty(input, "files", {
      value: [new File([JSON.stringify(oversized)], "oversized.json", { type: "application/json" })],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/too long|length|characters/i));
    expect(useStore.getState().data).toEqual(before);
  });

  it("binds server preview, password proof and apply to one document and revision", async () => {
    const incoming = document();
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        requests.push({ url: path, body });
        if (path.endsWith("/api/transfer/preview"))
          return Response.json({ baseRevision: 7, imported: 5, changed: true });
        if (path.endsWith("/api/auth/action-proof/password")) return Response.json({ proofId: "proof-7" });
        if (path.endsWith("/api/transfer/apply")) return Response.json({ imported: 5, changed: true, revision: 8 });
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    renderTools(true);
    await previewFile(incoming);
    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    expect(requests.map((request) => request.url)).toEqual(["/api/transfer/preview"]);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "current-password" } });
    fireEvent.click(screen.getByTestId("action-proof-confirm"));
    await waitFor(() =>
      expect(requests.map((request) => request.url)).toEqual([
        "/api/transfer/preview",
        "/api/auth/action-proof/password",
        "/api/transfer/apply",
      ]),
    );
    expect(requests[1]?.body).toMatchObject({
      action: "import",
      accountId,
      intent: { baseRevision: 7, document: incoming },
    });
    expect(requests[2]?.body).toMatchObject({ accountId, baseRevision: 7, document: incoming, proofId: "proof-7" });
  });

  it.each([403, 409])("keeps parked edits after a refused %i import", async (status) => {
    await submitServerImport(Response.json({ error: "Import refused." }, { status }));
    await waitFor(() => expect(persistenceProbe.resumes).toEqual([{ dropParkedEdits: false }]));
    expect(useStore.getState().notice).toMatchObject({ tone: "error", message: "Import refused." });
  });

  it("reloads the authoritative slice after an uncertain import response", async () => {
    await submitServerImport(Response.json({ error: "Unknown outcome." }, { status: 503 }));
    await waitFor(() => expect(persistenceProbe.resumes).toEqual([{ dropParkedEdits: true }]));
    expect(useStore.getState().notice?.tone).toBe("warning");
  });

  it.each(["failed", "skipped", "unattached"])(
    "keeps writes suspended and requires reload when a committed import refresh is %s",
    async (kind) => {
      refreshOverride.result = { kind };
      await submitServerImport(Response.json({ imported: 5, changed: true, revision: 8 }));
      await screen.findByTestId("import-reload-required");
      expect(persistenceProbe.resumes).toEqual([]);
      expect(useStore.getState().notice?.tone).toBe("error");
    },
  );

  it("ignores a cancelled file's late preview before confirming a newer selection", async () => {
    const first = document();
    const second = document();
    const secondAccount = second.data.accounts[0];
    if (!secondAccount) throw new Error("The second import fixture has no company.");
    secondAccount.name = "Wayne Enterprises replacement";
    const previews: Array<(response: Response) => void> = [];
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const path = String(url);
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
        requests.push({ url: path, body });
        if (path.endsWith("/api/transfer/preview")) return new Promise<Response>((resolve) => previews.push(resolve));
        if (path.endsWith("/api/auth/action-proof/password"))
          return Promise.resolve(Response.json({ proofId: "proof-b" }));
        if (path.endsWith("/api/transfer/apply"))
          return Promise.resolve(Response.json({ imported: 5, changed: true, revision: 23 }));
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
    renderTools(true);
    await selectFile(first);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(previews).toHaveLength(1));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await selectFile(second);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(previews).toHaveLength(2));
    previews[0]?.(Response.json({ baseRevision: 11, imported: 5, changed: true }));
    expect(screen.queryByRole("button", { name: "Replace data" })).toBeNull();
    previews[1]?.(Response.json({ baseRevision: 22, imported: 5, changed: true }));
    await screen.findByRole("button", { name: "Replace data" });
    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "current-password" } });
    fireEvent.click(screen.getByTestId("action-proof-confirm"));
    await waitFor(() => expect(requests.some((request) => request.url.endsWith("/api/transfer/apply"))).toBe(true));
    const proof = requests.find((request) => request.url.endsWith("/api/auth/action-proof/password"));
    expect(proof?.body.intent).toEqual({ baseRevision: 22, document: second });
    const apply = requests.find((request) => request.url.endsWith("/api/transfer/apply"));
    expect(apply?.body).toMatchObject({ baseRevision: 22, document: second, proofId: "proof-b" });
  });

  it("offers linked Google confirmation and Cancel issues no proof or import", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requests.push(String(url));
        return Response.json({ baseRevision: 7, imported: 5, changed: true });
      }),
    );
    renderTools(true, "provider");
    await previewFile(document());
    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    expect(screen.getByText(/Choose your linked Google account/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(requests).toEqual(["/api/transfer/preview"]);
    expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBeNull();
  });

  it("stores only opaque import confirmation metadata before Google navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/api/transfer/preview")
          ? Response.json({ baseRevision: 7, imported: 5, changed: true })
          : Response.json({ proofId: "proof-google", url: "https://accounts.google.test/confirm" }),
      ),
    );
    renderTools(true, "provider");
    await previewFile(document());
    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(sessionStorage.getItem("capacitylens/import-action-proof")).not.toBeNull());
    const saved = JSON.parse(sessionStorage.getItem("capacitylens/import-action-proof") ?? "null") as Record<
      string,
      unknown
    >;
    expect(saved).toEqual({ accountId, baseRevision: 7, proofId: "proof-google" });
    expect(JSON.stringify(sessionStorage)).not.toContain("resources");
  });

  it("resumes only its own returned provider proof and still needs an explicit apply click", async () => {
    const incoming = document();
    sessionStorage.setItem(
      "capacitylens/import-action-proof",
      JSON.stringify({ accountId, baseRevision: 7, proofId: "proof-google" }),
    );
    window.history.replaceState(null, "", "/settings?capacitylensActionConfirmed=1");
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      void _init;
      if (String(url).endsWith("/api/transfer/preview"))
        return Response.json({ baseRevision: 7, imported: 5, changed: false });
      return Response.json({ imported: 5, changed: false, revision: 7 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTools(true, "provider");
    await screen.findByText(/Choose the same import file again/);
    expect(fetchMock).not.toHaveBeenCalled();
    await previewFile(incoming);
    expect(fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(body.proofId).toBe("proof-google");
    expect(body.document).toEqual(incoming);
    expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBeNull();
  });

  it("surfaces refusal when the file reselected after Google differs from the proved import", async () => {
    const different = document();
    const account = different.data.accounts[0];
    if (!account) throw new Error("The replacement fixture has no company.");
    account.name = "Different Wayne company";
    const before = structuredClone(useStore.getState().data);
    sessionStorage.setItem(
      "capacitylens/import-action-proof",
      JSON.stringify({ accountId, baseRevision: 7, proofId: "proof-original" }),
    );
    window.history.replaceState(null, "", "/settings?capacitylensActionConfirmed=1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/api/transfer/preview")
          ? Response.json({ baseRevision: 7, imported: 5, changed: true })
          : Response.json({ error: "The confirmation does not match this import." }, { status: 403 }),
      ),
    );
    renderTools(true, "provider");
    await screen.findByText(/Choose the same import file again/);
    await previewFile(different);
    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    await waitFor(() => expect(useStore.getState().notice?.message).toMatch(/does not match this import/i));
    expect(useStore.getState().data).toEqual(before);
    expect(persistenceProbe.resumes).toEqual([{ dropParkedEdits: false }]);
  });

  it("waits for the selected company to hydrate before reading a returned provider proof", async () => {
    const saved = JSON.stringify({ accountId, baseRevision: 7, proofId: "proof-hydrating" });
    useStore.getState().setActiveAccount(null);
    sessionStorage.setItem("capacitylens/import-action-proof", saved);
    window.history.replaceState(null, "", "/settings?capacitylensActionConfirmed=1");
    renderTools(true, "provider");
    expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBe(saved);
    useStore.getState().setActiveAccount(accountId);
    await screen.findByText(/Choose the same import file again/);
    expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBeNull();
  });

  it("discards a failed provider return marker without retaining the import file", async () => {
    sessionStorage.setItem(
      "capacitylens/import-action-proof",
      JSON.stringify({ accountId, baseRevision: 7, proofId: "proof-cancelled" }),
    );
    renderTools(true, "provider");
    await waitFor(() => expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBeNull());
    expect(screen.queryByText(/Choose the same import file again/)).toBeNull();
  });

  it("refuses a returned import proof for another selected company", async () => {
    sessionStorage.setItem(
      "capacitylens/import-action-proof",
      JSON.stringify({ accountId: "a-loft", baseRevision: 7, proofId: "proof-other" }),
    );
    window.history.replaceState(null, "", "/settings?capacitylensActionConfirmed=1");
    renderTools(true, "provider");
    await waitFor(() => expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBeNull());
    expect(screen.queryByText(/Choose the same import file again/)).toBeNull();
    expect(useStore.getState().notice?.tone).toBe("error");
  });

  it("hides server import from non-owners while keeping export", () => {
    serverFlag.on = true;
    render(
      <PermissionContext.Provider value={{ role: "editor", status: "resolved" }}>
        <ImportExport />
      </PermissionContext.Provider>,
    );
    expect(screen.queryByTestId("import-input")).toBeNull();
    expect(screen.getByTestId("export-data")).toBeInTheDocument();
  });
});
