import { describe, expect, it } from "vitest";
import nginx from "../nginx.conf?raw";
import clientNginxTemplate from "../nginx.client.conf.template?raw";
import securityHeaders from "../nginx-security-headers.conf?raw";
import { renderClientNginx } from "../scripts/render-client-nginx.mjs";

function locationBlock(config: string, declaration: string): string {
  const start = config.indexOf(declaration);
  expect(start, `missing nginx location: ${declaration}`).toBeGreaterThanOrEqual(0);
  const end = config.indexOf("\n    }", start);
  expect(end, `unterminated nginx location: ${declaration}`).toBeGreaterThan(start);
  return config.slice(start, end);
}

describe("SPA content security policy", () => {
  it("keeps packaged nginx compatible with inline scheduler geometry and same-origin APIs", () => {
    expect(securityHeaders).toContain("script-src 'self'");
    expect(securityHeaders).toContain("style-src 'self'; style-src-attr 'unsafe-inline'");
    expect(securityHeaders).toContain("connect-src $capacitylens_connect_src");
    expect(securityHeaders).toContain("report-uri /api/security/csp-report");
    expect(securityHeaders).toContain("report-to csp-endpoint");
    expect(securityHeaders).toContain("Reporting-Endpoints");
    expect(securityHeaders).toContain('Cross-Origin-Embedder-Policy "require-corp"');
    expect(securityHeaders).toContain('Cross-Origin-Opener-Policy "same-origin"');
    expect(securityHeaders).toContain('Cross-Origin-Resource-Policy "same-origin"');
    expect(nginx).toContain("set $capacitylens_connect_src \"'self'\"");
    expect(nginx.match(/include \/etc\/nginx\/capacitylens-security-headers\.conf;/g)).toHaveLength(4);

    // Each location-level Cache-Control declaration cancels nginx's inherited add_header set.
    // Pin the shared policy include inside every static/SPA-serving block rather than merely
    // finding the required CSP text somewhere else in the configuration.
    for (const declaration of ["location ^~ /assets/ {", "location ~ ^/(invite|reset-password)/ {", "location / {"]) {
      expect(locationBlock(nginx, declaration)).toContain("include /etc/nginx/capacitylens-security-headers.conf;");
    }
  });

  it("verifies the internal API certificate and has no plaintext proxy fallback", () => {
    expect(nginx).toContain("proxy_ssl_verify on");
    expect(nginx).toContain("proxy_ssl_name api");
    expect(nginx).toContain("proxy_ssl_protocols TLSv1.2 TLSv1.3");
    expect(nginx).toContain("proxy_pass https://api:8787");
    expect(nginx).not.toContain("proxy_pass http://api:8787");
  });

  it("keeps hashed assets on the immutable cache location ahead of file-extension matching", () => {
    expect(nginx).toContain("location ^~ /assets/ {");
    expect(nginx).toContain("expires 1y;");
    expect(nginx).toContain('Cache-Control "public, max-age=31536000, immutable"');
  });

  it("renders a static-only demo config without a local API or certificate dependency", () => {
    const rendered = renderClientNginx(clientNginxTemplate, {
      VITE_CAPACITYLENS_DEMO: "1",
      VITE_CAPACITYLENS_API: "https://ignored.example.test",
    });

    expect(rendered).toContain("set $capacitylens_connect_src \"'self'\"");
    expect(rendered).toContain("location /api/");
    expect(rendered).not.toContain("__CAPACITYLENS_CONNECT_SOURCES__");
    expect(rendered).not.toContain("proxy_pass");
    expect(rendered).not.toContain("proxy_ssl_");
    expect(rendered).not.toContain("/run/capacitylens-internal-tls");
  });

  it("allows only the configured remote API origin in a client-only build", () => {
    const rendered = renderClientNginx(clientNginxTemplate, {
      VITE_CAPACITYLENS_DEMO: "",
      VITE_CAPACITYLENS_API: "  https://API.EXAMPLE.test:443///  ",
    });

    expect(rendered).toContain("set $capacitylens_connect_src \"'self' https://api.example.test\"");
    expect(() => renderClientNginx(clientNginxTemplate, {})).toThrow(/requires VITE_CAPACITYLENS_DEMO=1/);
    expect(() =>
      renderClientNginx(clientNginxTemplate, {
        VITE_CAPACITYLENS_API: "https://api.example.test/path",
      }),
    ).toThrow(/without credentials, path, query or fragment/);
    expect(() =>
      renderClientNginx(clientNginxTemplate, {
        VITE_CAPACITYLENS_API: "file:///tmp/api",
      }),
    ).toThrow(/HTTP\(S\) origin/);
  });
});
