import app from '@adonisjs/core/services/app';
import env from '#start/env';
import { resolvePublicOrigin } from '@kevinjohn/adonisjs-origin-guard';

const environment = app.inProduction ? 'production' : app.inTest ? 'test' : 'development';
const configuredPublicUrl = env.get('CAPACITYLENS_PUBLIC_URL');
// Name the variable actually used, so a refused APP_URL fallback is not reported as the public URL.
export const publicOrigin = configuredPublicUrl
  ? resolvePublicOrigin(configuredPublicUrl, environment, 'CAPACITYLENS_PUBLIC_URL')
  : resolvePublicOrigin(env.get('APP_URL'), environment, 'APP_URL');
