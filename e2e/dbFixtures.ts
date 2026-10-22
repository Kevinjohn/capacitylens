import { test as base, expect } from "./fixtures";
import { API, ensureDbFixtureAdministrator } from "./serverTestState";

const admin = { email: "admin@admin.admin", password: "auth-e2e-password-2026" };

/** Signs both the API client and browser into the disposable SQLite server. */
export const test = base.extend<{ dbAuthentication: void }>({
  dbAuthentication: [
    async ({ request, context }, use) => {
      ensureDbFixtureAdministrator();
      const apiSignIn = await request.post(`${API}/api/auth/sign-in`, { data: admin });
      expect(apiSignIn.status()).toBe(200);
      const browserSignIn = await context.request.post(`${API}/api/auth/sign-in`, { data: admin });
      expect(browserSignIn.status()).toBe(200);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { APIRequestContext, Page } from "./fixtures";
