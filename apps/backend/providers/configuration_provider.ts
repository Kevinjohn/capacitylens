// The server runs the Masquerade package's `masquerade:prune` at startup and hourly: it ends
// expired modes and deletes view-as events older than 365 days. A failed pass is logged and retried
// on the next one. The operator can also run `masquerade:prune`, `masquerade:status` and
// `masquerade:stop`.

import type { ApplicationService } from '@adonisjs/core/types';
import logger from '@adonisjs/core/services/logger';
import capacitylens from '#config/capacitylens';
import db from '@adonisjs/lucid/services/db';
import { rememberSchemaIntegrity } from '#services/schema_integrity';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { bootstrapDevelopmentCredential } from '#services/development_bootstrap';
import {
  createMaintenance,
  pruneRequestReceipts,
  pruneExpiredMasquerades,
} from '#services/storage_maintenance';

const PRUNE_INTERVAL_MS = 60 * 60_000;

interface ProductionPosture {
  allowReset?: boolean;
  createAdmin?: boolean;
  bootstrapPassword?: string;
  rateLimit?: string;
  fixedToday?: string;
}

export function assertProductionPosture(options: ProductionPosture) {
  if (options.createAdmin || options.bootstrapPassword) {
    throw new Error('Development bootstrap credentials are forbidden in production');
  }
  if (
    options.rateLimit !== undefined &&
    (!/^\d+$/.test(options.rateLimit) ||
      Number(options.rateLimit) < 1 ||
      Number(options.rateLimit) > 1_000_000)
  ) {
    throw new Error('CAPACITYLENS_RATE_LIMIT must be an integer from 1 to 1,000,000 in production');
  }
  if (options.allowReset) throw new Error('CAPACITYLENS_ALLOW_RESET is forbidden in production');
  if (options.fixedToday) throw new Error('CAPACITYLENS_FIXED_TODAY is forbidden in production');
}

export default class ConfigurationProvider {
  private pruneTimer?: NodeJS.Timeout;

  constructor(protected app: ApplicationService) {}
  async boot() {
    if (this.app.inProduction) {
      assertProductionPosture({
        allowReset: capacitylens.allowReset,
        createAdmin: capacitylens.createAdmin,
        bootstrapPassword: capacitylens.bootstrapAdminPassword,
        rateLimit: capacitylens.rateLimit,
        fixedToday: capacitylens.fixedToday,
      });
    }
  }

  async start() {
    // Code generation warms a web app without serving requests or closing database pools.
    if (this.app.getMode() === 'warmup') return;
    // Console commands opt into application startup through their native startApp option.
    if (this.app.getEnvironment() === 'console') return;
    const rows = await db
      .from('sqlite_master')
      .where({ type: 'table', name: 'accounts' })
      .select('name');
    if (rows.length > 0) {
      await rememberSchemaIntegrity();
      await bootstrapDevelopmentCredential(this.app);
    }
  }

  /**
   * Expired sign-ins fail at once; pruning removes them at start and hourly, and with them the
   * session-bound proofs and restoration rows that cascade from each one. The same pass removes
   * completed request receipts and expired view-as modes and events.
   */
  async ready() {
    if (this.app.getEnvironment() !== 'web' || this.app.inTest) return;
    // Shutdown can begin while an earlier provider is still getting ready; a pass started after
    // that would reopen the database once it has been closed.
    if (this.app.isTerminating || this.app.isTerminated) return;
    // Each task reports its own failure, so one failing does not skip the others.
    const maintenance = createMaintenance(
      [
        ['Account sign-in pruning', () => accountKit.maintenance.prune()],
        ['Request receipt pruning', () => pruneRequestReceipts()],
        ['Masquerade pruning', () => pruneExpiredMasquerades(this.app)],
      ],
      (task, error) =>
        logger.error(
          { task, errorName: error instanceof Error ? error.name : 'unknown' },
          `${task} failed`
        )
    );
    // A pass still in flight would reopen the database after shutdown closed it.
    this.app.terminating(() => maintenance.stop());
    void maintenance.run();
    this.pruneTimer = setInterval(() => void maintenance.run(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  async shutdown() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }
}
