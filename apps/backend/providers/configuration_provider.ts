import type { ApplicationService } from '@adonisjs/core/types';
import env from '#start/env';
import db from '@adonisjs/lucid/services/db';
import { assertSchemaIntegrity } from '#services/schema_integrity';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { bootstrapDevelopmentCredential } from '#services/development_bootstrap';

const PRUNE_INTERVAL_MS = 60 * 60_000;

function assertAuthenticationConfiguration() {
  const secret = env.get('CAPACITYLENS_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error(
      'CAPACITYLENS_SECRET must contain at least 32 characters when authentication is enabled'
    );
  }
}

interface ProductionPosture {
  allowReset?: boolean;
  createAdmin?: boolean;
  bootstrapPassword?: string;
  rateLimit?: string;
  audit?: string;
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
  if (options.audit === 'off') {
    throw new Error('CAPACITYLENS_AUDIT=off is not permitted in production');
  }
  if (options.allowReset) throw new Error('CAPACITYLENS_ALLOW_RESET is forbidden in production');
}

export default class ConfigurationProvider {
  private pruneTimer?: NodeJS.Timeout;

  constructor(protected app: ApplicationService) {}
  async boot() {
    assertAuthenticationConfiguration();
    if (this.app.inProduction) {
      assertProductionPosture({
        allowReset: env.get('CAPACITYLENS_ALLOW_RESET'),
        createAdmin: env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN'),
        bootstrapPassword: env.get('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD'),
        rateLimit: env.get('CAPACITYLENS_RATE_LIMIT'),
        audit: env.get('CAPACITYLENS_AUDIT'),
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
      await assertSchemaIntegrity();
      await bootstrapDevelopmentCredential(this.app);
    }
  }

  /**
   * Expired sign-ins fail at once; pruning removes them at start and hourly, and with them the
   * session-bound proofs and restoration rows that cascade from each one. Queued mail is sent after
   * the request answers, so a transport failure is only visible here; the log carries the error
   * name, never the message, which can hold an address or link.
   */
  async ready() {
    const emitter = await this.app.container.make('emitter');
    emitter.on('queued:mail:error', ({ error, mailerName }) => {
      console.error('Queued mail delivery failed', {
        mailer: mailerName,
        error: error instanceof Error ? error.name : 'unknown',
      });
    });
    if (this.app.getEnvironment() !== 'web' || this.app.inTest) return;
    const prune = () =>
      accountKit.maintenance.prune().catch((error: unknown) => {
        console.error(
          'Account sign-in pruning failed',
          error instanceof Error ? error.name : error
        );
      });
    void prune();
    this.pruneTimer = setInterval(() => void prune(), PRUNE_INTERVAL_MS);
    this.pruneTimer.unref();
  }

  async shutdown() {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }
}
