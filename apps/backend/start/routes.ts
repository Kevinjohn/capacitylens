import router from '@adonisjs/core/services/router';
import app from '@adonisjs/core/services/app';
import { controllers } from '#generated/controllers';
import { middleware } from '#start/kernel';
import { throttle } from '#start/limiter';
import { registerAuthRoutes } from '#start/auth_routes';
import { registerMembershipRoutes } from '#start/membership_routes';
import { registerAdmissionRoutes } from '#start/admission_routes';
import { registerMasqueradeRoutes } from '#start/masquerade_routes';
import { registerOwnershipRoutes } from '#start/ownership_routes';
import { registerPlanningRoutes } from '#start/planning_routes';
import { registerCompanyRoutes } from '#start/company_routes';
import { registerImportRoutes } from '#start/import_routes';
import { registerExportRoutes } from '#start/export_routes';
import { registerAnonymiseRoutes } from '#start/anonymise_routes';
import { registerExampleDataRoutes } from '#start/example_data_routes';
import { registerGettingStartedRoutes } from '#start/getting_started_routes';
import { registerDiagnosticsRoutes } from '#start/diagnostics_routes';

// The Access Control package accepts string keys of 1 to 254 characters. A longer company or member
// identifier matches no route and answers 404 instead of reaching the package.
for (const param of ['companyId', 'userId']) router.where(param, /^.{1,254}$/);

// Health is registered first, in its own group, so the API throttle does not count it.
router
  .group(() => {
    router.get('/health', [controllers.Liveness]);
  })
  .prefix('/api')
  .as('api');

router
  .group(() => {
    registerPlanningRoutes();
    registerCompanyRoutes();
    registerImportRoutes();
    registerExportRoutes();
    registerAnonymiseRoutes();
    registerExampleDataRoutes();
    registerGettingStartedRoutes();
    registerAuthRoutes();
    registerMembershipRoutes();
    registerAdmissionRoutes();
    registerMasqueradeRoutes();
    registerOwnershipRoutes();
    registerDiagnosticsRoutes();
    router
      .get('/*', ({ response }) => response.notFound({ error: 'Not found' }))
      .use(middleware.accountGate({ access: 'limited' }))
      .as('not_found');
  })
  .prefix('/api')
  .as('api')
  .use(throttle);

router.get('/health/live', [controllers.Liveness]);
router.get('/health/ready', [controllers.HealthChecks]);
// A page address is single-slash segments of URL-safe characters. Only such an address is ever a
// redirect target, so a trailing-slash request cannot be answered with a link to another host.
const PAGE_ADDRESS = /^(?:\/[\w.~%-]+)+$/;

router.get('*', async ({ request, response }) => {
  const path = request.url().split('?', 1)[0];
  // A page address typed with a trailing slash opens the same page at the address without it.
  const page = path === '/' ? path : path.replace(/\/+$/, '');
  const lastSegment = page.slice(page.lastIndexOf('/') + 1);
  if (
    path.startsWith('/assets/') ||
    path.startsWith('/api/') ||
    lastSegment.includes('.') ||
    (page !== path && !PAGE_ADDRESS.test(page))
  ) {
    return response.notFound('Not found');
  }
  if (page !== path) {
    // The query string is forwarded as it arrived; the redirect helper would rewrite it.
    const raw = request.request.url ?? '';
    const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    return response.redirect().status(301).clearQs().toPath(`${page}${query}`);
  }
  response.header('Cache-Control', 'no-store');
  return response.download(app.publicPath('index.html'));
});
