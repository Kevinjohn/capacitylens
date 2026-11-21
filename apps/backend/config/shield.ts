// Shield owns HSTS, `nosniff`, frame protection and the CSP.

import { publicOrigin } from '#config/public_origin';
import { defineConfig } from '@adonisjs/shield';

const shieldConfig = defineConfig({
  csp: {
    enabled: true,

    /**
     * One policy for API responses, the SPA document and static assets. The SPA sets layout
     * geometry with inline style attributes, so `style-src-attr` allows those, not style elements.
     */
    directives: {
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
    },

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
