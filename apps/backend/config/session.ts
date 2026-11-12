import { publicOrigin } from '#config/public_origin';
import { defineConfig, stores } from '@adonisjs/session';
import { SESSION_IDLE_EXPIRY } from '#services/auth/session_expiry';

const secure = publicOrigin.secure;

const sessionConfig = defineConfig({
  /**
   * Enable or disable session support globally.
   */
  enabled: true,

  /**
   * Cookie name storing the session identifier.
   */
  cookieName: secure ? '__Host-adonis-session' : 'adonis-session',

  /**
   * When set to true, the session id cookie will be deleted
   * once the user closes the browser.
   */
  clearWithBrowser: false,

  /**
   * Define how long to keep the session data alive without
   * any activity. Matches the Account Kit sign-in registry.
   */
  age: SESSION_IDLE_EXPIRY,

  /**
   * Configuration for the session cookie.
   */
  cookie: {
    /**
     * Restrict the cookie to a URL path. '/' means all routes.
     */
    path: '/',

    /**
     * Prevent JavaScript access to the cookie in the browser.
     */
    httpOnly: true,

    /**
     * Send cookies only over HTTPS when the public URL is HTTPS.
     */
    secure,

    /**
     * Cross-site policy for cookie sending.
     */
    sameSite: 'lax',
  },

  /**
   * Sessions always use the database registry.
   */
  store: 'database',

  /**
   * List of configured stores. Refer documentation to see
   * list of available stores and their config.
   */
  stores: {
    /**
     * Store session data inside the configured database.
     */
    database: stores.database({ tableName: 'adonis_sessions' }),
  },
});

export default sessionConfig;
