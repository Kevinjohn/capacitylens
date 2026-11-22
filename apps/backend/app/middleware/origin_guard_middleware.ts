// Unsafe requests are accepted only from the public URL's origin or a `CAPACITYLENS_CORS_ORIGIN`
// entry (a development server also trusts the dev launcher's lane origins); when that is unset
// outside production, the built-in `localhost` and `127.0.0.1` origins on ports 5173 and 5273 are
// trusted. With no Origin, only `Sec-Fetch-Site: same-origin` is accepted.
// `@kevinjohn/adonisjs-origin-guard` supplies the check, the origin parsers and the private-peer
// list used for proxy trust. This middleware runs straight after the security headers
// (`start/kernel.ts`), so a refusal still carries them.

import { createOriginGuard } from '@kevinjohn/adonisjs-origin-guard';
import { publicOrigin } from '#config/public_origin';
import { corsOrigins } from '#config/cors';

/** Refuses unsafe requests from any origin other than the public URL's or a configured CORS origin. */
export default createOriginGuard({
  publicOrigin: publicOrigin.origin,
  allowedOrigins: corsOrigins,
});
