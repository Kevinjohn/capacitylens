import { defineConfig } from '@adonisjs/auth'
import type { InferAuthenticators } from '@adonisjs/auth/types'
import { sessionGuard, sessionUserProvider } from '@adonisjs/auth/session'

type AuthConfig = {
  web: ReturnType<typeof sessionGuard>
}

const authConfig: ReturnType<typeof defineConfig<AuthConfig>> = defineConfig({
  default: 'web',
  guards: {
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
