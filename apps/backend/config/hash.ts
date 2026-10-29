import { defineConfig, drivers } from '@adonisjs/core/hash';

/**
 * Hashing configuration.
 *
 * This starter uses Node.js scrypt under the hood.
 * Node.js reference: https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback
 */
const hashConfig = defineConfig({
  /**
   * Default hasher used by the application.
   */
  default: 'scrypt',

  list: {
    /**
     * Scrypt is memory-hard, which makes brute-force attacks more expensive.
     */
    scrypt: drivers.scrypt({
      /**
       * Work factor (Node alias: N / cost).
       * Higher values increase security and CPU+memory usage.
       *
       * This product uses the OWASP scrypt profile N=2^14, r=8, p=5.
       * Keep this aligned with the documented 16 MiB memory target.
       *
       * Node constraint: value must be a power of two greater than 1.
       */
      cost: 16384,

      /**
       * Block size (Node alias: r / blockSize).
       * Increases memory and CPU linearly.
       *
       * Tuning guideline:
       * - Keep 8 unless you have a measured reason to change it.
       * - Raise only with benchmark data, because memory usage grows quickly.
       */
      blockSize: 8,

      /**
       * Parallelization (Node alias: p / parallelization).
       * Controls how many independent computations are performed.
       * The OWASP minimum at the selected 16 MiB memory target uses 5.
       */
      parallelization: 5,

      /**
       * Maximum memory limit in bytes (Node alias: maxmem / maxMemory).
       * Hashing throws if the estimated memory usage is above this limit.
       * Node documents the check as approximately: 128 * N * r > maxmem.
       *
       * Tuning guideline:
       * - Keep this aligned with your cost/blockSize choices.
       * - Increase carefully on memory-constrained environments.
       */
      maxMemory: 33554432,
    }),
  },
});

export default hashConfig;

/**
 * Inferring types for the list of hashers you have configured
 * in your application.
 */
declare module '@adonisjs/core/types' {
  export interface HashersList extends InferHashers<typeof hashConfig> {}
}
