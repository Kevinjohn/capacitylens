import { test as base, expect } from './fixtures';
import { ensureDbFixtureAdministrator, resetServer } from './serverTestState';
import { startWorkerServer } from './workerServer';
import type { E2eWorkerServer } from './workerServer';

const admin = { email: 'admin@admin.admin', password: 'auth-e2e-password-2026' };

type WorkerFixtures = { dbServer: E2eWorkerServer };
type TestFixtures = { dbReset: void; dbAuthentication: void };

/** Database-backed specs each receive an isolated real API, Vite proxy and SQLite file. */
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
      await resetServer({ target: dbServer.target });
      await use();
    },
    { auto: true },
  ],
  dbAuthentication: [
    async ({ dbReset, dbServer, request, context }, use) => {
      void dbReset;
      ensureDbFixtureAdministrator(dbServer.target);
      const apiSignIn = await request.post(`${dbServer.target.api}/api/auth/sign-in`, {
        data: admin,
      });
      expect(apiSignIn.status()).toBe(200);
      const browserSignIn = await context.request.post(`${dbServer.target.api}/api/auth/sign-in`, {
        data: admin,
      });
      expect(browserSignIn.status()).toBe(200);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { APIRequestContext, Locator, Page } from './fixtures';
