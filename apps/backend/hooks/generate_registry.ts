import type { HookParams } from '@adonisjs/assembler/types';
import { generateRegistry } from '@tuyau/core/hooks';

// The browser narrows every error body itself, including Vine's 422 `{ errors }`, so the registry
// does not type validation errors.
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
