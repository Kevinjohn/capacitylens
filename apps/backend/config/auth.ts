import { defineConfig } from '@adonisjs/auth'
import type { Authenticators, InferAuthenticators, InferAuthEvents } from '@adonisjs/auth/types'
import { trustedLocalGuard } from '#auth/guards/trusted_local'

const authConfig = defineConfig({
  default: 'trustedLocal',
  guards: { trustedLocal: trustedLocalGuard() },
})

export default authConfig

declare module '@adonisjs/auth/types' {
  export interface Authenticators extends InferAuthenticators<typeof authConfig> {}
}
declare module '@adonisjs/core/types' {
  interface EventsList extends InferAuthEvents<Authenticators> {}
}
