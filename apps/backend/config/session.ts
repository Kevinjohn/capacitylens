import env from '#start/env'
import { defineConfig, stores } from '@adonisjs/session'

const secure =
  new URL(env.get('CAPACITYLENS_PUBLIC_URL') || env.get('APP_URL')).protocol === 'https:'

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
   * any activity.
   */
  age: '30m',

  /**
   * Configuration for session cookie and the
   * cookie store.
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
   * The store to use. Make sure to validate the environment
   * variable in order to infer the store name without any
   * errors.
   */
  store: 'database',

  /**
   * List of configured stores. Refer documentation to see
   * list of available stores and their config.
   */
  stores: {
    /**
     * Store session data inside encrypted cookies.
     */
    cookie: stores.cookie(),

    /**
     * Store session data inside the configured database.
     */
    database: stores.database({ tableName: 'adonis_sessions' }),
  },
})

export default sessionConfig
