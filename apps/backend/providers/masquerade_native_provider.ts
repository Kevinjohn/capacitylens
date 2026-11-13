import type { ApplicationService } from '@adonisjs/core/types';

/** Binds the Account Kit authority the Masquerade provider builds its runtime from. */
export default class MasqueradeNativeProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton('masquerade.native', async () => {
      const config = await import('#config/masquerade');
      return config.nativeAdapter;
    });
  }
}
