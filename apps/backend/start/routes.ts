import '#start/planning_routes';
import router from '@adonisjs/core/services/router';
import { fileURLToPath } from 'node:url';
import { healthChecks } from '#start/health';
import { registerAuthRoutes } from '#start/auth_routes';
import { registerMembershipRoutes } from '#start/membership_routes';
import { registerAdmissionRoutes } from '#start/admission_routes';
import { registerMasqueradeRoutes } from '#start/masquerade_routes';
import { registerOwnershipRoutes } from '#start/ownership_routes';
import { registerCompanyRoutes } from '#start/company_routes';
import { registerTransferRoutes } from '#start/transfer_routes';
import { registerExportRoutes } from '#start/export_routes';
import { registerAnonymiseRoutes } from '#start/anonymise_routes';
import { registerExampleDataRoutes } from '#start/example_data_routes';
import { registerGettingStartedRoutes } from '#start/getting_started_routes';
import { registerDiagnosticsRoutes } from '#start/diagnostics_routes';

// The Access Control package accepts string keys of 1 to 254 characters. A longer company or member
// identifier matches no route and answers 404 instead of reaching the package.
for (const param of ['accountId', 'userId']) router.where(param, /^.{1,254}$/);

registerCompanyRoutes();
registerTransferRoutes();
registerExportRoutes();
registerAnonymiseRoutes();
registerExampleDataRoutes();
registerGettingStartedRoutes();
registerAuthRoutes();
registerMembershipRoutes();
registerAdmissionRoutes();
registerMasqueradeRoutes();
registerOwnershipRoutes();

router.get('/api/health', () => ({ ok: true })).as('api.health');
router.get('/health/live', () => ({ ok: true }));
router.get('/health/ready', async ({ response }) => {
  try {
    const report = await healthChecks.run();
    return report.isHealthy ? response.ok(report) : response.serviceUnavailable(report);
  } catch {
    return response.serviceUnavailable({ isHealthy: false, status: 'error', checks: [] });
  }
});
registerDiagnosticsRoutes();
router.get('*', async ({ request, response }) => {
  const path = request.url().split('?', 1)[0];
  if (path.startsWith('/api/')) return response.notFound({ error: 'Not found' });
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  if (
    path.startsWith('/assets/') ||
    (path !== '/' && path.endsWith('/')) ||
    lastSegment.includes('.')
  ) {
    return response.notFound('Not found');
  }
  response.header('Cache-Control', 'no-store');
  return response.download(fileURLToPath(new URL('../public/index.html', import.meta.url)));
});
