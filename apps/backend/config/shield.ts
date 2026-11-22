// Shield sets HSTS, nosniff, frame protection and the CSP on routed responses; security_headers_middleware repeats them for static files and server-stack refusals.

import { publicOrigin } from '#config/public_origin';
import { defineConfig } from '@adonisjs/shield';

/**
 * One policy for API responses, the SPA document and static assets. The SPA sets layout
 * geometry with inline style attributes, so `style-src-attr` allows those, not style elements.
 */
const contentSecurityPolicyDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  styleSrcAttr: ["'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'"],
  connectSrc: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
};

/** The CSP header value Shield sends, repeated by the security headers middleware outside the router. */
export const contentSecurityPolicy = Object.entries(contentSecurityPolicyDirectives)
  .map(
    ([name, values]) =>
      `${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} ${values.join(' ')}`
  )
  .join(';');

const shieldConfig = defineConfig({
  csp: {
    enabled: true,

    directives: contentSecurityPolicyDirectives,

    reportOnly: false,
  },

  csrf: {
    enabled: false,
    exceptRoutes: [],
    enableXsrfCookie: false,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  },

  // X-Frame-Options for clients that ignore the CSP frame-ancestors directive.
  xFrame: {
    enabled: true,
    action: 'DENY',
  },

  hsts: {
    // Sent host-only, and only when the public URL is HTTPS.
    enabled: publicOrigin.secure,
    maxAge: '365 days',
    includeSubDomains: false,
  },

  contentTypeSniffing: {
    enabled: true,
  },
});

export default shieldConfig;
