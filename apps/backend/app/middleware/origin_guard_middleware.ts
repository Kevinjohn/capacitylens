import { createOriginGuard } from '@kevinjohn/adonisjs-origin-guard';
import { publicOrigin } from '#config/public_origin';
import { corsOrigins } from '#services/cors_policy';

/** Refuses unsafe requests from any origin other than the public URL's or a configured CORS origin. */
export default createOriginGuard({
  publicOrigin: publicOrigin.origin,
  allowedOrigins: corsOrigins,
});
