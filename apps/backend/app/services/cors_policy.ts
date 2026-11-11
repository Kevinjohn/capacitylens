import env from '#start/env';
import { publicOrigin } from '#config/public_origin';

const defaultOrigins =
  'http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273';

/** Resolves the finite development defaults; production cross-origin access is explicit. */
export function resolveCorsOrigins(configured: string | undefined, environment: string) {
  return (configured ?? (environment === 'production' ? '' : defaultOrigins))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      if (origin === '*') {
        throw new Error('CORS requires explicit origins when credentials are enabled');
      }
      const parsed = new URL(origin);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error(
          `Invalid CORS origin ${JSON.stringify(origin)}: expected a bare HTTP(S) origin`
        );
      }
      return parsed.origin;
    });
}

export const corsOrigins = resolveCorsOrigins(
  env.get('CAPACITYLENS_CORS_ORIGIN'),
  env.get('NODE_ENV')
);

interface TrustedOriginInput {
  origin?: string;
  fetchSite?: string;
}

/** Resolves whether an unsafe browser request comes from the public origin or an explicit CORS origin. */
export function isTrustedUnsafeOrigin({ origin, fetchSite }: TrustedOriginInput) {
  if (!origin) return fetchSite === 'same-origin';
  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }
  return normalizedOrigin === publicOrigin.origin || corsOrigins.includes(normalizedOrigin);
}
