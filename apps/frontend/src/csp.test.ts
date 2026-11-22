import { describe, expect, it } from 'vitest';
import nginx from '../../../nginx.conf?raw';
import securityHeaders from '../../../nginx-security-headers.conf?raw';

function locationBlock(config: string, declaration: string): string {
  const start = config.indexOf(declaration);
  expect(start, `missing nginx location: ${declaration}`).toBeGreaterThanOrEqual(0);
  const end = config.indexOf('\n    }', start);
  expect(end, `unterminated nginx location: ${declaration}`).toBeGreaterThan(start);
  return config.slice(start, end);
}

describe('SPA content security policy', () => {
  it('keeps packaged nginx compatible with inline scheduler geometry and same-origin APIs', () => {
    expect(securityHeaders).toContain("script-src 'self'");
    expect(securityHeaders).toContain("style-src 'self'; style-src-attr 'unsafe-inline'");
    expect(securityHeaders).toContain('connect-src $capacitylens_connect_src');
    expect(securityHeaders).not.toMatch(/report-uri|report-to|Reporting-Endpoints/);
    expect(securityHeaders).not.toContain('add_header Strict-Transport-Security');
    expect(securityHeaders).toContain('Cross-Origin-Embedder-Policy "require-corp"');
    expect(securityHeaders).toContain('Cross-Origin-Opener-Policy "same-origin"');
    expect(securityHeaders).toContain('Cross-Origin-Resource-Policy "same-origin"');
    expect(nginx).toContain('set $capacitylens_connect_src "\'self\'"');
    expect(nginx.match(/include \/etc\/nginx\/capacitylens-security-headers\.conf;/g)).toHaveLength(
      4,
    );

    // Each location-level Cache-Control declaration cancels nginx's inherited add_header set.
    // Pin the shared policy include inside every static/SPA-serving block rather than merely
    // finding the required CSP text somewhere else in the configuration.
    for (const declaration of [
      'location ^~ /assets/ {',
      'location ~* ^/(invite|reset-password|verify-email)/ {',
      'location / {',
    ]) {
      expect(locationBlock(nginx, declaration)).toContain(
        'include /etc/nginx/capacitylens-security-headers.conf;',
      );
    }
  });

  it('proxies only to the fixed private API and overwrites public-edge forwarding headers', () => {
    const targets = [...nginx.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1]);
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets)).toEqual(new Set(['http://api:8787']));
    expect(nginx).not.toMatch(/proxy_ssl_|capacitylens-internal-tls/);
    for (const declaration of [
      'location /api/ {',
      'location ~ ^/api/invitations/[^/]+/(accept|signup|preview)$ {',
      'location ~ ^/api/auth/(callback|oauth2/callback)/ {',
    ]) {
      const block = locationBlock(nginx, declaration);
      expect(block).toContain('proxy_set_header Host $http_host;');
      expect(block).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
      expect(block).toContain('proxy_set_header X-Forwarded-Proto $capacitylens_public_proto;');
      expect(block).not.toContain('$proxy_add_x_forwarded_for');
    }
  });

  it('keeps hashed assets on the immutable cache location ahead of file-extension matching', () => {
    expect(nginx).toContain('location ^~ /assets/ {');
    expect(nginx).toContain('expires 1y;');
    expect(nginx).toContain('Cache-Control "public, max-age=31536000, immutable"');
  });
});
