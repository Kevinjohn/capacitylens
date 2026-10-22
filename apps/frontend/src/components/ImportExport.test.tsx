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
const refreshOverride = vi.hoisted(() => ({ kind: "reloaded" as const }));
vi.mock("@/data/apiConfig", () => ({
  API_BASE: "",
  isServerConfigured: () => serverFlag.on,
  isDemoMode: () => !serverFlag.on,
}));
vi.mock("@/data/persist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/persist")>()),
  refreshActiveAccountSlice: async () => refreshOverride,
  flushPendingWrites: async () => ({ kind: "clean" as const }),
  suspendServerWrites: () => () => {},
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

beforeEach(async () => {
  serverFlag.on = false;
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

  it("resumes only its own returned provider proof and still needs an explicit apply click", async () => {
    const incoming = document();
    sessionStorage.setItem(
      "capacitylens/import-action-proof",
      JSON.stringify({
        accountId,
        document: incoming,
        baseRevision: 7,
        proofId: "proof-google",
      }),
    );
    window.history.replaceState(null, "", "/settings?capacitylensActionConfirmed=1");
    const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => {
      void args;
      return Response.json({ imported: 5, changed: false, revision: 7 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderTools(true, "provider");
    await screen.findByRole("button", { name: "Replace data" });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.proofId).toBe("proof-google");
    expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBeNull();
  });

  it("waits for the selected company to hydrate before reading a returned provider proof", async () => {
    const incoming = document();
    const saved = JSON.stringify({ accountId, document: incoming, baseRevision: 7, proofId: "proof-hydrating" });
    useStore.getState().setActiveAccount(null);
    sessionStorage.setItem("capacitylens/import-action-proof", saved);
    window.history.replaceState(null, "", "/settings?capacitylensActionConfirmed=1");
    renderTools(true, "provider");
    expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBe(saved);
    useStore.getState().setActiveAccount(accountId);
    await screen.findByRole("button", { name: "Replace data" });
    expect(sessionStorage.getItem("capacitylens/import-action-proof")).toBeNull();
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
