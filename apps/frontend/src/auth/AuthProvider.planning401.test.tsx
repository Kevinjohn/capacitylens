import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("./masqueradeApi", () => ({ masqueradeApi: { status: vi.fn(async () => ({ active: false })) } }));
vi.mock("@/data/planning/volatilePlanningTransport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/planning/volatilePlanningTransport")>();
  const { createPlanningTransport } = await import("@/data/planning/planningTransport");
  return { ...actual, createStorePlanningTransport: () => createPlanningTransport() };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("revalidates /me after a real planning GET returns 401 and clears private queries", async () => {
  vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
  vi.resetModules();
  let authReads = 0;
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      if (url.endsWith("/api/auth/me")) {
        authReads += 1;
        return Response.json(
          authReads === 1
            ? { authMode: "password-only", user: { id: "u1", email: "a@b.test" } }
            : { authMode: "password-only", providers: [] },
          { status: authReads === 1 ? 200 : 401 },
        );
      }
      return Response.json({ error: "Sign in", code: "unauthenticated" }, { status: 401 });
    }),
  );
  const { AuthProvider } = await import("./AuthProvider");
  const { useStore } = await import("@/store/useStore");
  const { queryClient } = await import("@/api/queryClient");

  render(
    <AuthProvider>
      <div>app-content</div>
    </AuthProvider>,
  );
  expect(await screen.findByText("app-content")).toBeInTheDocument();
  queryClient.setQueryData(["private-account"], "sensitive data");
  await act(async () => {
    useStore.setState({ activeAccountId: "a-studio" });
    await useStore.getState().refreshPlanning({ fresh: true });
  });

  expect(requests).toContain("http://api.test/api/accounts/a-studio/planning");
  expect(useStore.getState().planningAuthLossVersion).toBeGreaterThan(0);
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(queryClient.getQueryData(["private-account"])).toBeUndefined();
  expect(useStore.getState().masquerade.kind).toBe("inactive");
});
