import app from '@adonisjs/core/services/app';
import env from '#start/env';

/** Resolve the one origin shared by action links and browser transport security. */
export function resolvePublicOrigin(
  value: string,
  environment: 'production' | 'development' | 'test',
  variable: string
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable} must be a bare HTTP(S) origin`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error(`${variable} must be a bare HTTP(S) origin`);
  if (
    url.protocol !== 'https:' &&
    (environment === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error(
      environment === 'production'
        ? `${variable}: public production origins require HTTPS`
        : `${variable} must use HTTPS outside loopback in development/test`
    );
  return { origin: url.origin, secure: url.protocol === 'https:' };
}

const environment = app.inProduction ? 'production' : app.inTest ? 'test' : 'development';
const configuredPublicUrl = env.get('CAPACITYLENS_PUBLIC_URL');
// Name the variable actually used, so a refused APP_URL fallback is not reported as the public URL.
export const publicOrigin = configuredPublicUrl
  ? resolvePublicOrigin(configuredPublicUrl, environment, 'CAPACITYLENS_PUBLIC_URL')
  : resolvePublicOrigin(env.get('APP_URL'), environment, 'APP_URL');
