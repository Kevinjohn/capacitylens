import env from '#start/env';
import { parseOrigins } from '@kevinjohn/adonisjs-origin-guard';

const defaultOrigins =
  'http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273';

/** Resolves the finite development defaults; production cross-origin access is explicit. */
export function resolveCorsOrigins(configured: string | undefined, environment: string) {
  return parseOrigins(configured ?? (environment === 'production' ? '' : defaultOrigins));
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
