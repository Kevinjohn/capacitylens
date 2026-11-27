import { isPrivatePeer } from '@kevinjohn/adonisjs-origin-guard'
import { publicOrigin } from '#config/public_origin'
import env from '#start/env'
import { defineConfig } from '@adonisjs/core/http'

export const http = defineConfig({
  requestTimeout: 30_000,
  timeout: 30_000,
  generateRequestId: true,
  allowMethodSpoofing: false,
  useAsyncLocalStorage: false,

  /**
   * Forwarded client address and protocol headers are trusted only when the operator enables them:
   * from loopback (the framework default), or with `private` also from private-network peers such
   * as the packaged nginx on the Compose network. Otherwise no peer is trusted.
   */
  trustProxy: {
    off: () => false,
    loopback: undefined,
    private: isPrivatePeer,
  }[env.get('CAPACITYLENS_TRUST_PROXY_HEADERS')],

  router: {
    matcher: 'tree',
  },

  redirect: {
    forwardQueryString: true,
  },

  cookie: {
    domain: '',
    path: '/',
    maxAge: '2h',
    httpOnly: true,
    secure: publicOrigin.secure,
    sameSite: 'lax',
  },
})
