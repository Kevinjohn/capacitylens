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

/** Appends the full-stack dev launcher's lane web origins, which only a development server trusts. */
export function withDevelopmentWebOrigins(
  origins: string[],
  devWebOrigins: string | undefined,
  environment: string
) {
  return environment === 'development' && devWebOrigins
    ? [...origins, ...resolveCorsOrigins(devWebOrigins, environment)]
    : origins;
}

export const corsOrigins = withDevelopmentWebOrigins(
  resolveCorsOrigins(env.get('CAPACITYLENS_CORS_ORIGIN'), env.get('NODE_ENV')),
  env.get('CAPACITYLENS_DEV_WEB_ORIGINS'),
  env.get('NODE_ENV')
);

interface TrustedOriginInput {
  origin?: string;
  fetchSite?: string;
}

/** Resolves whether an unsafe browser request comes from the public origin or an explicit CORS origin. */
export function isTrustedUnsafeOrigin({ origin, fetchSite }: TrustedOriginInput) {
  if (!origin) return fetchSite === 'same-origin';
  // Browsers send the serialized origin, the same form as the configured origins.
  return origin === publicOrigin.origin || corsOrigins.includes(origin);
}
