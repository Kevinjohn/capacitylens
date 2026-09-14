import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountClient } from "./accountClient";
import { invalidateResourceAvatars, useResourceAvatars } from "./useResourceAvatars";
import { setOfflineReadState } from "../data/offlineCache";
import { AuthContext } from "../auth/authContext";
import { useStore } from "../store/useStore";

vi.mock("./accountClient", () => ({ accountClient: { listResourceAvatars: vi.fn() } }));
vi.mock("../data/apiConfig", () => ({ isServerConfigured: () => true }));

function response(avatars: unknown[]): Response {
  return new Response(JSON.stringify({ avatars }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("useResourceAvatars", () => {
  beforeEach(() => {
    vi.mocked(accountClient.listResourceAvatars)
      .mockReset()
      .mockImplementation(async () => response([]));
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });
  afterEach(() => setOfflineReadState("cleanup", false));

  it("clears immediately, refreshes on invalidation, and validates normalized URLs", async () => {
    vi.mocked(accountClient.listResourceAvatars)
      .mockResolvedValueOnce(response([{ resourceId: "r1", imageUrl: " https://images.example/a.png " }]))
      .mockResolvedValueOnce(response([{ resourceId: "r1", imageUrl: "https://images.example/b.png" }]));
    const { result } = renderHook(() => useResourceAvatars("a1"));
    await waitFor(() => expect(result.current.get("r1")).toBe("https://images.example/a.png"));
    act(() => invalidateResourceAvatars());
    expect(result.current.size).toBe(0);
    await waitFor(() => expect(result.current.get("r1")).toBe("https://images.example/b.png"));
  });

  it("discards stale in-flight responses across an A to B to A transition", async () => {
    let resolveFirst!: (value: Response) => void;
    vi.mocked(accountClient.listResourceAvatars)
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{ resourceId: "r1", imageUrl: "https://images.example/fresh.png" }]));
    const { result, rerender } = renderHook(({ accountId }) => useResourceAvatars(accountId), {
      initialProps: { accountId: "a1" as string | null },
    });
    await act(async () => rerender({ accountId: "a2" }));
    await act(async () => rerender({ accountId: "a1" }));
    await waitFor(() => expect(result.current.get("r1")).toBe("https://images.example/fresh.png"));
    await act(async () => resolveFirst(response([{ resourceId: "r1", imageUrl: "https://images.example/stale.png" }])));
    expect(result.current.get("r1")).toBe("https://images.example/fresh.png");
  });

  it("clears on offline and refreshes when connectivity resumes", async () => {
    vi.mocked(accountClient.listResourceAvatars)
      .mockResolvedValueOnce(response([{ resourceId: "r1", imageUrl: "https://images.example/a.png" }]))
      .mockResolvedValueOnce(response([{ resourceId: "r1", imageUrl: "https://images.example/b.png" }]));
    const { result } = renderHook(() => useResourceAvatars("a1"));
    await waitFor(() => expect(result.current.size).toBe(1));
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current.size).toBe(0);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(result.current.get("r1")).toBe("https://images.example/b.png"));
  });

  it("does not fetch in app read-only mode even while the browser reports online", async () => {
    setOfflineReadState("tenant", true, Date.now());
    renderHook(() => useResourceAvatars("a1"));
    await act(async () => Promise.resolve());
    expect(accountClient.listResourceAvatars).not.toHaveBeenCalled();
    act(() => setOfflineReadState("tenant", false));
    await waitFor(() => expect(accountClient.listResourceAvatars).toHaveBeenCalledOnce());
  });

  it("refreshes after session and ordinary account-data refresh signals", async () => {
    vi.mocked(accountClient.listResourceAvatars).mockImplementation(async () => response([]));
    const authValue = (image: string) => ({
      authMode: "sso" as const,
      user: { id: "u1", image },
      canCreateAccount: true,
      multiAccount: true,
      refreshAuth: async () => {},
      signOut: async () => {},
    });
    function Probe({ image }: { image: string }) {
      void image;
      useResourceAvatars("a1");
      return null;
    }
    function WrappedProbe({ image }: { image: string }) {
      return (
        <AuthContext.Provider value={authValue(image)}>
          <Probe image={image} />
        </AuthContext.Provider>
      );
    }
    const view = render(<WrappedProbe image="https://images.example/one.png" />);
    await waitFor(() => expect(accountClient.listResourceAvatars).toHaveBeenCalledTimes(1));
    view.rerender(<WrappedProbe image="https://images.example/two.png" />);
    await waitFor(() => expect(accountClient.listResourceAvatars).toHaveBeenCalledTimes(2));
    act(() => useStore.setState((state) => ({ data: { ...state.data } })));
    await waitFor(() => expect(accountClient.listResourceAvatars).toHaveBeenCalledTimes(3));
  });
});
