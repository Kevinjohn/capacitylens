import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PermissionContext } from "../auth/permissionContext";
import { notifyInactiveDataChanged } from "../data/inactiveDataEvents";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { makeAccount, makeClient } from "../test/fixtures";
import { useInactiveAccountData } from "./useInactiveAccountData";

vi.mock("../data/apiConfig", () => ({ API_BASE: "http://api.test", isServerConfigured: () => true }));

function payload(accountId: string, name: string) {
  return {
    ...emptyAppData(),
    accounts: [makeAccount({ id: accountId })],
    clients: [makeClient({ id: `client-${accountId}`, accountId, name, archivedAt: "2026-01-01T00:00:00.000Z" })],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Probe() {
  const { data } = useInactiveAccountData();
  return <div>{data?.clients.map((client) => client.name).join(",") ?? "hidden"}</div>;
}

function view(role: "admin" | "editor") {
  return (
    <PermissionContext.Provider value={{ role, status: "resolved" }}>
      <Probe />
    </PermissionContext.Provider>
  );
}

beforeEach(() => {
  useStore.setState({ activeAccountId: "a1" });
});

afterEach(() => vi.unstubAllGlobals());

describe("useInactiveAccountData", () => {
  it("invalidates its private server slice after a lifecycle mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload("a1", "First") })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload("a1", "Refreshed") });
    vi.stubGlobal("fetch", fetchMock);
    render(view("admin"));
    expect(await screen.findByText(/First/)).toBeInTheDocument();
    notifyInactiveDataChanged("a1");
    expect(await screen.findByText(/Refreshed/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not reveal an old admin response after an editor role transition", async () => {
    const first = deferred<{ ok: boolean; status: number; json: () => Promise<ReturnType<typeof payload>> }>();
    const second = deferred<{ ok: boolean; status: number; json: () => Promise<ReturnType<typeof payload>> }>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const rendered = render(view("admin"));
    rendered.rerender(view("editor"));
    first.resolve({ ok: true, status: 200, json: async () => payload("a1", "Stale") });
    await waitFor(() => expect(screen.getByText("hidden")).toBeInTheDocument());
    rendered.rerender(view("admin"));
    expect(screen.getByText("hidden")).toBeInTheDocument();
    second.resolve({ ok: true, status: 200, json: async () => payload("a1", "Fresh") });
    expect(await screen.findByText(/Fresh/)).toBeInTheDocument();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });

  it("does not reuse account A data while A is being refetched after A → B → A", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload("a1", "Old A") })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => payload("a2", "B") })
        .mockReturnValueOnce(new Promise(() => undefined)),
    );
    render(view("admin"));
    expect(await screen.findByText(/Old A/)).toBeInTheDocument();
    useStore.setState({ activeAccountId: "a2" });
    expect(await screen.findByText(/^B,/)).toBeInTheDocument();
    useStore.setState({ activeAccountId: "a1" });
    await waitFor(() => expect(screen.getByText("hidden")).toBeInTheDocument());
    expect(screen.queryByText("Old A")).not.toBeInTheDocument();
  });
});
