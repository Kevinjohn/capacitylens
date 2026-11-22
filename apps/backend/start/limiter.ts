import limiter from '@adonisjs/limiter/services/main';
import { readApiLimit, requestClientKey } from '#services/auth/request_limit';

/** One request budget a minute per client address for the API; off when the limit is 0. */
export const throttle = limiter.define('api', (ctx) => {
  const requests = readApiLimit();
  if (!requests) return limiter.noLimit();
  return limiter
    .allowRequests(requests)
    .every('1 minute')
    .usingKey(requestClientKey(ctx.request.ip()));
});
