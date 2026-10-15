// Canonicalise the build-time API origin once so live requests and offline namespaces
// share the same backend identity. Demo builds retain scheduling data only in memory.

function readOptionalEnvironmentString(value: unknown, variableName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${variableName} must be a string.`);
  }
  return value;
}

function parseApiBase(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (raw === "") return "";

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw new Error("VITE_CAPACITYLENS_API must be an absolute HTTP(S) origin.", { cause });
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !/^\/*$/.test(parsed.pathname) ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("VITE_CAPACITYLENS_API must be an HTTP(S) origin without credentials, path, query or fragment.");
  }
  return parsed.origin;
}

/** API path prefix, empty when requests use the current origin. */
export const API_BASE = isDemoMode()
  ? ""
  : parseApiBase(readOptionalEnvironmentString(import.meta.env.VITE_CAPACITYLENS_API, "VITE_CAPACITYLENS_API"));

/** Demo mode: an editable, in-memory seed that resets on refresh.
 * Note: this is the persistence demo, distinct from the cosmetic auth persona
 * (the cosmetic fake sign-in: `useDemoAuthActive`/`FakeSignIn`/`fakeAuth.ts`, keyed off authMode 'off'). */
export function isDemoMode(): boolean {
  return import.meta.env.VITE_CAPACITYLENS_DEMO === "1";
}

/** Returns true unless the build explicitly selects the in-memory demo. API_BASE does not affect this choice. */
export function isServerConfigured(): boolean {
  return !isDemoMode();
}
