// Canonicalise the API origin for live requests.

function readOptionalEnvironmentString(value: unknown, variableName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${variableName} must be a string.`);
  }
  return value;
}

function parseApiBase(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (raw === '') return '';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw new Error('VITE_CAPACITYLENS_API must be an absolute HTTP(S) origin.', { cause });
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    !/^\/*$/.test(parsed.pathname) ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      'VITE_CAPACITYLENS_API must be an HTTP(S) origin without credentials, path, query or fragment.',
    );
  }
  return parsed.origin;
}

/** API path prefix, empty when requests use the current origin. */
export const API_BASE = parseApiBase(
  readOptionalEnvironmentString(import.meta.env.VITE_CAPACITYLENS_API, 'VITE_CAPACITYLENS_API'),
);
