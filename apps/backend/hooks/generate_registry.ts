import type { HookParams } from '@adonisjs/assembler/types';
import { generateRegistry } from '@tuyau/core/hooks';

// Validation refusals use our flat 400 adapter, rather than Vine's default 422 body.
const registry = generateRegistry({ validationErrorType: false });

/**
 * Writes the API client registry, except in an e2e worker API server: the workers share one
 * `.adonisjs/client/registry`, and only the e2e global setup's code generation writes it.
 */
export default async function generateRegistryHook(...args: HookParams<'init'>) {
  if (process.env.CAPACITYLENS_E2E_WORKER_API === '1') return;
  if (!('run' in registry)) throw new Error('generateRegistry returned a lazy hook');
  await registry.run(...args);
}
