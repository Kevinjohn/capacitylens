import app from '@adonisjs/core/services/app';
import limiter from '@adonisjs/limiter/services/main';
import capacitylens from '#config/capacitylens';
import { readApiLimit, requestClientKey } from '#services/auth/request_limit';

/** One request budget a minute per client address for the API; off when the limit is 0. */
export const throttle = limiter.define('api', (ctx) => {
  const requests = readApiLimit(capacitylens.rateLimit, app.inProduction);
  if (!requests) return limiter.noLimit();
  return limiter
    .allowRequests(requests)
    .every('1 minute')
    .usingKey(requestClientKey(ctx.request.ip()));
});
