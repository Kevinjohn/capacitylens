import { defineConfig } from '@adonisjs/cors';
import { corsOrigins } from '#services/cors_policy';

/**
 * Configuration options to tweak the CORS policy. The following
 * options are documented on the official documentation website.
 *
 * https://docs.adonisjs.com/guides/security/cors
 */
const corsConfig = defineConfig({
  /**
   * Enable or disable CORS handling globally.
   */
  enabled: true,

  /**
   * Use the configured origins (or the documented local development origins).
   * Production has no cross-origin defaults; configure the public frontend origin
   * with CAPACITYLENS_CORS_ORIGIN when deploying it separately.
   */
  origin: corsOrigins,

  /**
   * HTTP methods accepted for cross-origin requests.
   */
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  /**
   * Reflect request headers by default. Use a string array to restrict
   * allowed headers.
   */
  headers: [
    'Content-Type',
    'Idempotency-Key',
    'x-account-command-id',
    'x-capacitylens-sync-session',
    'x-capacitylens-sync-sequence',
  ],

  /**
   * Response headers exposed to the browser.
   */
  exposeHeaders: [],

  /**
   * Allow cookies/authorization headers on cross-origin requests.
   */
  credentials: true,

  /**
   * Cache CORS preflight response for N seconds.
   */
  maxAge: 90,
});

export default corsConfig;
