import { readFileSync } from "node:fs";
import { get } from "node:https";

const port = process.env.PORT || 8787;
const cert = process.env.CAPACITYLENS_INTERNAL_TLS_CERT;
const key = process.env.CAPACITYLENS_INTERNAL_TLS_KEY;
const ca = process.env.CAPACITYLENS_INTERNAL_TLS_CA;

// Docker owns the five-second timeout. A nonzero exit surfaces an unhealthy container; do not
// wait for a response body or keep the process alive through the HTTP client's connection pool.
if (!cert && !key) {
  fetch(`http://127.0.0.1:${port}/api/health`)
    .then((response) => process.exit(response.ok ? 0 : 1))
    .catch(() => process.exit(1));
} else {
  // Compose supplies its internal CA and the certificate's api hostname. Without a CA this is
  // only the existing loopback liveness probe; nginx independently verifies upstream TLS.
  get(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/health",
      ...(ca ? { ca: readFileSync(ca), servername: "api" } : { rejectUnauthorized: false }),
    },
    (response) => process.exit(response.statusCode >= 200 && response.statusCode < 300 ? 0 : 1),
  ).on("error", () => process.exit(1));
}
