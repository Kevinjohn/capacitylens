import { defineConfig } from '@adonisjs/cors';
import { corsOrigins } from '#services/cors_origins';

const corsConfig = defineConfig({
  enabled: true,

  /**
   * Use the configured origins (or the documented local development origins).
   * Production has no cross-origin defaults; configure the public frontend origin
   * with CAPACITYLENS_CORS_ORIGIN when deploying it separately.
   */
  origin: corsOrigins,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  headers: [
    'Content-Type',
    'Idempotency-Key',
    'x-account-command-id',
    'x-capacitylens-sync-session',
    'x-capacitylens-sync-sequence',
  ],

  exposeHeaders: [],
  credentials: true,
  maxAge: 90,
});

export default corsConfig;
