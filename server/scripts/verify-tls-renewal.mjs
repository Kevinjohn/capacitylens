import { readFileSync } from "node:fs";
import { get } from "node:http";

const marker = readFileSync(process.env.CAPACITYLENS_INTERNAL_TLS_GENERATION, "utf8").trim();
const request = get("http://web:8080/api/health", (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => {
    body += chunk;
  });
  response.on("end", () => {
    try {
      const health = JSON.parse(body);
      if (response.statusCode < 200 || response.statusCode >= 300 || health.internalTls?.fingerprintSha256 !== marker) {
        throw new Error("live fingerprint does not match the published generation");
      }
      console.log("capacitylens-internal-tls: coordinated renewal verified");
    } catch (error) {
      console.error(`capacitylens-internal-tls: renewal verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  });
});
request.on("error", (error) => {
  console.error(`capacitylens-internal-tls: renewal verification failed: ${error.message}`);
  process.exitCode = 1;
});
