import { isPrivatePeer } from '@kevinjohn/adonisjs-origin-guard';
import { publicOrigin } from '#config/public_origin';
import env from '#start/env';
import { defineConfig } from '@adonisjs/core/http';

/**
 * The configuration settings used by the HTTP server
 */
export const http = defineConfig({
  requestTimeout: 30_000,
  timeout: 30_000,
  /**
   * Generate a unique request id for each incoming request.
   * Useful to correlate logs and debug a request flow.
   */
  generateRequestId: true,

  /**
   * Allow HTTP method spoofing via the "_method" form/query parameter.
   * This lets HTML forms target PUT/PATCH/DELETE routes while still
   * submitting with POST.
   */
  allowMethodSpoofing: false,

  /**
   * Enabling async local storage will let you access HTTP context
   * from anywhere inside your application.
   */
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

  /**
   * Redirect configuration controls the behavior of
   * response.redirect().back() and query string forwarding.
   */
  redirect: {
    /**
     * When enabled, all redirects automatically carry over the current
     * request's query string parameters to the redirect destination.
     * Use withQs(false) to opt out for a specific redirect.
     */
    forwardQueryString: true,
  },

  /**
   * Manage cookies configuration. The settings for the session id cookie are
   * defined inside the "config/session.ts" file.
   */
  cookie: {
    /**
     * Restrict the cookie to a specific domain.
     * Keep empty to use the current host.
     */
    domain: '',

    /**
     * Restrict the cookie to a URL path. '/' means all routes.
     */
    path: '/',

    /**
     * Default lifetime for cookies managed by the HTTP layer.
     */
    maxAge: '2h',

    /**
     * Prevent JavaScript access to the cookie in the browser.
     */
    httpOnly: true,

    /**
     * Send cookies only over HTTPS when the public URL is HTTPS.
     */
    secure: publicOrigin.secure,

    /**
     * Cross-site policy for cookie sending.
     */
    sameSite: 'lax',
  },
});
