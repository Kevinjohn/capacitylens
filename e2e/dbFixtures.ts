import { test as base, expect } from './fixtures';
import { ensureDbTestAdmin, requireTestTagHeaders, resetServer } from './serverTestState';
import { startWorkerServer } from './workerServer';
import type { E2eWorkerServer } from './workerServer';

const admin = { email: 'admin@admin.admin', password: 'auth-e2e-password-2026' };

type WorkerFixtures = { dbServer: E2eWorkerServer };
type TestFixtures = { dbReset: void; dbAuthentication: void };

/** Database-backed specs each receive an isolated real API serving the built SPA, and a SQLite file. */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  dbServer: [
    // This worker runtime is independent of Playwright's browser and request fixtures.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const runtime = await startWorkerServer(workerInfo.parallelIndex);
      try {
        await use(runtime);
      } finally {
        await runtime.stop();
      }
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  baseURL: [async ({ dbServer }, use) => use(dbServer.baseURL), { scope: 'test' }],
  dbReset: [
    async ({ dbServer }, use) => {
      await resetServer({ target: dbServer.target, newTest: true });
      await use();
    },
    { auto: true },
  ],
  // The page, `context.request` and the `request` fixture all send the tag of the reset that just
  // ran; the worker API refuses an `/api/` request without it.
  extraHTTPHeaders: async ({ dbReset, extraHTTPHeaders }, use) => {
    void dbReset;
    await use({ ...extraHTTPHeaders, ...requireTestTagHeaders() });
  },
  dbAuthentication: [
    async ({ dbReset, dbServer, request, context }, use) => {
      void dbReset;
      ensureDbTestAdmin(dbServer.target);
      const apiSignIn = await request.post(`${dbServer.target.api}/api/v1/auth/sign-in`, {
        data: admin,
        headers: { 'sec-fetch-site': 'same-origin' },
      });
      expect(apiSignIn.status()).toBe(200);
      const browserSignIn = await context.request.post(
        `${dbServer.target.api}/api/v1/auth/sign-in`,
        {
          data: admin,
          headers: { 'sec-fetch-site': 'same-origin' },
        },
      );
      expect(browserSignIn.status()).toBe(200);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { APIRequestContext, Locator, Page } from './fixtures';
