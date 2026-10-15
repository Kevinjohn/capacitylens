import type { HttpContext } from '@adonisjs/core/http'
import type { AuthClientResponse, GuardConfigProvider, GuardContract } from '@adonisjs/auth/types'

export const trustedLocalUser = {
  id: 'demo',
  name: 'Demo',
  email: 'demo@capacitylens.local',
  emailVerified: true,
  image: null,
} as const

export class TrustedLocalGuard {
  readonly driverName = 'trusted_local'
  readonly user = trustedLocalUser
  readonly isAuthenticated = true
  authenticationAttempted = false

  getUserOrFail() {
    return this.user
  }

  async authenticate() {
    this.authenticationAttempted = true
    return this.user
  }

  async check() {
    this.authenticationAttempted = true
    return true
  }

  async authenticateAsClient(): Promise<AuthClientResponse> {
    return {}
  }
}

export function trustedLocalGuard(): GuardConfigProvider<
  (_ctx: HttpContext) => GuardContract<typeof trustedLocalUser>
> {
  return {
    resolver: async () => (_ctx) =>
      new TrustedLocalGuard() as TrustedLocalGuard & GuardContract<typeof trustedLocalUser>,
  }
}
