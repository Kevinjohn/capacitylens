import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
const healthcheckArgs = ["scripts/check-health.mjs"];
const root = fileURLToPath(new URL("../", import.meta.url));
const servers: Server[] = [];
let certificates: string;

beforeAll(() => {
  certificates = mkdtempSync(join(tmpdir(), "capacitylens-healthcheck-"));
  for (const name of ["api", "untrusted"]) {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        `/CN=${name}`,
        "-addext",
        `subjectAltName=DNS:${name}`,
        "-keyout",
        join(certificates, `${name}.key`),
        "-out",
        join(certificates, `${name}.crt`),
      ],
      { stdio: "pipe" },
    );
  }
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

afterAll(() => rmSync(certificates, { recursive: true, force: true }));

async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  return String(address.port);
}

async function probe(port: string, options: Record<string, string> = {}) {
  // Each child is an independent container-style invocation; ambient local TLS settings cannot
  // change its selected scheme or trust policy. A timeout fails the test rather than hanging CI.
  const child = spawn(process.execPath, healthcheckArgs, {
    cwd: root,
    env: {
      ...process.env,
      PORT: port,
      CAPACITYLENS_INTERNAL_TLS_CERT: "",
      CAPACITYLENS_INTERNAL_TLS_KEY: "",
      CAPACITYLENS_INTERNAL_TLS_CA: "",
      NODE_TLS_REJECT_UNAUTHORIZED: "1",
      ...options,
    },
    timeout: 3_000,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return await new Promise<{ code: number | null; signal: string | null; stderr: string }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stderr }));
  });
}

function tlsOptions(ca = "api") {
  return {
    CAPACITYLENS_INTERNAL_TLS_CERT: join(certificates, "api.crt"),
    CAPACITYLENS_INTERNAL_TLS_KEY: join(certificates, "api.key"),
    CAPACITYLENS_INTERNAL_TLS_CA: join(certificates, `${ca}.crt`),
  };
}

function tlsServer(status: number, identity = "api") {
  return createHttpsServer(
    {
      key: readFileSync(join(certificates, `${identity}.key`)),
      cert: readFileSync(join(certificates, `${identity}.crt`)),
    },
    (request, response) => {
      expect(request.url).toBe("/api/health");
      response.writeHead(status).end();
    },
  );
}

describe("container API healthcheck", () => {
  it("runs the tested script from the deployed server package", () => {
    expect(dockerfile).toMatch(/HEALTHCHECK[^]*?CMD \["node", "scripts\/check-health\.mjs"\]/);
    expect(dockerfile).toContain("COPY --from=server-deploy /prod/server ./");
  });
  it.each([200, 204, 299, 300, 404, 503])("maps HTTP status %i to the container exit status", async (status) => {
    const port = await listen(
      createHttpServer((request, response) => {
        expect(request.url).toBe("/api/health");
        response.writeHead(status).end();
      }),
    );
    expect(await probe(port)).toEqual({ code: status < 300 ? 0 : 1, signal: null, stderr: "" });
  });

  it("preserves HTTP redirect handling", async () => {
    const port = await listen(
      createHttpServer((request, response) => {
        if (request.url === "/api/health") response.writeHead(302, { location: "/healthy" }).end();
        else response.writeHead(200).end();
      }),
    );
    expect((await probe(port)).code).toBe(0);
  });

  it.each([200, 299, 300, 503])("verifies the configured CA and api hostname for TLS status %i", async (status) => {
    const port = await listen(tlsServer(status));
    expect(await probe(port, tlsOptions())).toEqual({ code: status < 300 ? 0 : 1, signal: null, stderr: "" });
  });

  it("rejects a server outside the configured CA", async () => {
    const port = await listen(tlsServer(200));
    expect((await probe(port, tlsOptions("untrusted"))).code).toBe(1);
  });

  it("rejects a trusted certificate for a different hostname", async () => {
    const port = await listen(tlsServer(200, "untrusted"));
    expect((await probe(port, tlsOptions("untrusted"))).code).toBe(1);
  });

  it("fails when the configured CA cannot be read", async () => {
    const port = await listen(tlsServer(200));
    const result = await probe(port, tlsOptions("missing"));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("ENOENT");
  });

  it.each(["CAPACITYLENS_INTERNAL_TLS_CERT", "CAPACITYLENS_INTERNAL_TLS_KEY"])(
    "uses the local TLS probe when only %s is present and no CA is supplied",
    async (setting) => {
      const port = await listen(tlsServer(200));
      expect(await probe(port, { [setting]: "configured" })).toEqual({ code: 0, signal: null, stderr: "" });
    },
  );

  it.each(["", "configured"])("reports a refused connection as unhealthy with certificate setting %j", async (cert) => {
    const server = createHttpServer();
    const port = await listen(server);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    servers.splice(servers.indexOf(server), 1);
    expect((await probe(port, { CAPACITYLENS_INTERNAL_TLS_CERT: cert })).code).toBe(1);
  });
});
