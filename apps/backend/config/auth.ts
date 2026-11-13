import { defineConfig } from '@adonisjs/auth';
import type { InferAuthenticators } from '@adonisjs/auth/types';
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session';
import { effectiveSessionGuard } from '@kevinjohn/adonisjs-masquerade/auth';

/** The raw session provider shared with the Masquerade Account Kit adapter. */
export const sessionUsers = sessionUserProvider({ model: () => import('#models/user') });

const webGuard = sessionGuard({ useRememberMeTokens: false, provider: sessionUsers });
const effectiveGuard = effectiveSessionGuard(webGuard);

type AuthConfig = {
  web: typeof webGuard;
  web_effective: typeof effectiveGuard;
};

/**
 * `web` is the signed-in person. `web_effective` is the viewed-as member while a view-as mode is
 * active and the signed-in person otherwise; member routes authenticate with it.
 */
const authConfig: ReturnType<typeof defineConfig<AuthConfig>> = defineConfig({
  default: 'web_effective',
  guards: {
    web: webGuard,
    web_effective: effectiveGuard,
  },
});

export default authConfig;

declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
