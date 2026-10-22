import { registerServerFixtureCleanup } from "./testHelpers/registerServerFixtureCleanup";
import { openDb as openDbRaw } from "./db";

/** Shared password-mode environment for tests that exercise the composed auth facade. */
export const PASSWORD_ENV = {
  CAPACITYLENS_MODE: "password-only",
  CAPACITYLENS_SECRET: "unit-test-secret-0123456789abcdef-0123",
  CAPACITYLENS_PUBLIC_URL: "http://localhost:8787",
};

const fixtures = registerServerFixtureCleanup();
/** Opens an in-memory or file-backed auth test database registered for cleanup. */
export const openDb = (...args: Parameters<typeof openDbRaw>) => fixtures.trackDb(openDbRaw(...args));
/** Narrows an optional auth result and names the missing test precondition. */
export const assertPresent = <T>(value: T, label: string): NonNullable<T> => {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
};
