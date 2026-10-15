import { defineConfig } from '@adonisjs/auth'
import type { InferAuthenticators } from '@adonisjs/auth/types'
import { trustedLocalGuard } from '#auth/guards/trusted_local'
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session'

type AuthConfig = {
  trustedLocal: ReturnType<typeof trustedLocalGuard>
  web: ReturnType<typeof sessionGuard>
}

const authConfig: ReturnType<typeof defineConfig<AuthConfig>> = defineConfig({
  default: 'trustedLocal',
  guards: {
    trustedLocal: trustedLocalGuard(),
    web: sessionGuard({
      useRememberMeTokens: false,
      provider: sessionUserProvider({ model: () => import('#models/user') }),
    }),
  },
})

export default authConfig

declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  // The trusted-local guard emits no auth events to add to the core event map.
  interface EventsList {}
}
