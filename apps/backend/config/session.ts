// Secure-cookie behaviour follows `CAPACITYLENS_PUBLIC_URL`.

import { publicOrigin } from '#config/public_origin'
import { defineConfig, stores } from '@adonisjs/session'
import { protectManagedSessionConfig } from '@kevinjohn/adonisjs-account-kit/http'

/** Sessions end after this long without use, in the Account Kit registry and the native store alike. */
export const SESSION_IDLE_EXPIRY = '14d'

const secure = publicOrigin.secure

const sessionConfig = defineConfig({
  enabled: true,
  cookieName: secure ? '__Host-adonis-session' : 'adonis-session',
  clearWithBrowser: false,

  // Matches the Account Kit sign-in registry's idle expiry.
  age: SESSION_IDLE_EXPIRY,

  cookie: {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'lax',
  },

  // Sessions always use the database registry.
  store: 'database',

  stores: {
    database: stores.database({ tableName: 'adonis_sessions' }),
  },
})

/** Account Kit refuses to read a session unless the store behind it deletes a destroyed session. */
export default protectManagedSessionConfig(sessionConfig, {
  verifyStore: (store) =>
    typeof store === 'object' && store !== null && store.constructor.name === 'DatabaseStore',
})
