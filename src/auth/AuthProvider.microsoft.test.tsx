import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("AuthProvider — Microsoft verification entry", () => {
  it.each(["/verify-microsoft", "/verify-microsoft/"])(
    "checks verification at %s without opening tenant access",
    async (path) => {
      vi.stubEnv("VITE_CAPACITYLENS_API", "http://api.test");
      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe("http://api.test/api/account/microsoft/status");
        return new Response(JSON.stringify({ state: "pending" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchSpy);
      window.history.replaceState({}, "", `${path}?state=check-email`);
      const onTenantAccessReady = vi.fn();
      vi.resetModules();
      const { AuthProvider } = await import("./AuthProvider");
      render(
        <AuthProvider onTenantAccessReady={onTenantAccessReady}>
          <div>app-content</div>
        </AuthProvider>,
      );

      expect(await screen.findByText(/Check your email for a verification link/)).toBeInTheDocument();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(onTenantAccessReady).not.toHaveBeenCalled();
    },
  );
});
