import router from '@adonisjs/core/services/router';
import { controllers } from '#generated/controllers';
import { middleware } from '#start/kernel';
import { throttle } from '#start/limiter';
import '#start/routes/health';
import '#start/routes/planning';
import '#start/routes/company';
import '#start/routes/import';
import '#start/routes/export';
import '#start/routes/anonymise';
import '#start/routes/example_data';
import '#start/routes/getting_started';
import '#start/routes/auth';
import '#start/routes/membership';
import '#start/routes/admission';
import '#start/routes/masquerade';
import '#start/routes/ownership';
import '#start/routes/diagnostics';

// The Access Control package accepts string keys of 1 to 254 characters. A longer company or member
// identifier matches no route and answers 404 instead of reaching the package.
for (const param of ['companyId', 'userId']) router.where(param, /^.{1,254}$/);
// A record id is at most 128 characters and an invitation link token at most 512. A longer one
// matches no route; a malformed one within the bound still answers the params validation failure.
router.where('id', /^.{1,128}$/);
router.where('token', /^.{1,512}$/);

// The catch-alls are registered after every area file, so they match only what no route does.
router
  .group(() => {
    router.get('/*', [controllers.NotFound]).use(middleware.accountGate({ access: 'limited' }));
  })
  .prefix('/api')
  .as('api')
  .use(throttle);

router.get('*', [controllers.SpaFallback]);
