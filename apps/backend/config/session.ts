// Secure-cookie behaviour follows `CAPACITYLENS_PUBLIC_URL`.

import { publicOrigin } from '#config/public_origin';
import { defineConfig, stores } from '@adonisjs/session';
import { protectManagedSessionConfig } from '@kevinjohn/adonisjs-account-kit/http';
import { SESSION_IDLE_EXPIRY } from '#services/auth/session_expiry';

const secure = publicOrigin.secure;

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
});

/** Account Kit refuses to read a session unless the store behind it deletes a destroyed session. */
export default protectManagedSessionConfig(sessionConfig, {
  verifyStore: (store) =>
    typeof store === 'object' && store !== null && store.constructor.name === 'DatabaseStore',
});
