import { defineConfig } from '@adonisjs/auth'
import type { InferAuthenticators } from '@adonisjs/auth/types'
import { trustedLocalGuard } from '#auth/guards/trusted_local'

type TrustedLocalConfig = { trustedLocal: ReturnType<typeof trustedLocalGuard> }

const authConfig: ReturnType<typeof defineConfig<TrustedLocalConfig>> = defineConfig({
  default: 'trustedLocal',
  guards: { trustedLocal: trustedLocalGuard() },
})

export default authConfig

declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  // The trusted-local guard emits no auth events to add to the core event map.
  interface EventsList {}
}
