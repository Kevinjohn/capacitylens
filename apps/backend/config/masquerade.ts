import app from '@adonisjs/core/services/app';
import { defineConfig } from '@kevinjohn/adonisjs-masquerade';
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid';

export default defineConfig({
  // The package opens the store while providers boot, before the `db` service import resolves.
  store: async () => {
    const database = await app.container.make('lucid.db');
    return new LucidControlStore(database.connection());
  },
  durationSeconds: 900,
  maxDurationSeconds: 900,
  contextEnforcement: 'enforce',
  retention: { days: 365 },
});
