import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const shell = readFileSync(new URL("../../scripts/renew-internal-tls.sh", import.meta.url), "utf8");
const verifierArgs = ["scripts/verify-tls-renewal.mjs"];
const root = fileURLToPath(new URL("../", import.meta.url));
const redirect = fileURLToPath(new URL("./__tests__/renewalProbeRedirect.mjs", import.meta.url));
const fingerprint = "a".repeat(64);
let directory: string;
let server: Server | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "capacitylens-renewal-"));
  writeFileSync(join(directory, "generation"), `  ${fingerprint}\n`);
});

afterEach(async () => {
  await closeServer();
  rmSync(directory, { recursive: true, force: true });
});

async function closeServer() {
  const listening = server;
  if (listening?.listening) {
    await new Promise<void>((resolve, reject) => {
      listening.close((error) => (error ? reject(error) : resolve()));
      listening.closeAllConnections();
    });
  }
  server = undefined;
}

async function listen(status: number, body: string) {
  const listening = createServer((request, response) => {
    expect(request.url).toBe("/api/health");
    response.writeHead(status, { "Content-Type": "application/json" });
    const middle = Math.floor(body.length / 2);
    response.write(body.slice(0, middle));
    setImmediate(() => response.end(body.slice(middle)));
  });
  server = listening;
  await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
  const address = listening.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  return String(address.port);
}

async function probe(port: string, marker: string | null = join(directory, "generation")) {
  const env: NodeJS.ProcessEnv = { ...process.env, CAPACITYLENS_TEST_HTTP_PORT: port };
  delete env.CAPACITYLENS_INTERNAL_TLS_GENERATION;
  if (marker !== null) env.CAPACITYLENS_INTERNAL_TLS_GENERATION = marker;
  const child = spawn(process.execPath, ["--import", redirect, ...verifierArgs], {
    cwd: root,
    env,
    timeout: 3_000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  return await new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    },
  );
}

describe("TLS renewal generation verification", () => {
  it("verifies through the deployed script after coordinated stop, rotation and restart", () => {
    const stop = shell.indexOf("docker compose stop web api");
    const rotate = shell.indexOf("CAPACITYLENS_INTERNAL_TLS_ROTATE=1");
    const restart = shell.indexOf("--force-recreate --wait");
    const verify = shell.indexOf("docker compose exec -T api node scripts/verify-tls-renewal.mjs");
    expect(stop).toBeGreaterThan(0);
    expect(rotate).toBeGreaterThan(stop);
    expect(restart).toBeGreaterThan(rotate);
    expect(verify).toBeGreaterThan(restart);
  });
  it.each([200, 201, 299])("accepts status %i only with the published fingerprint", async (status) => {
    const port = await listen(status, JSON.stringify({ internalTls: { fingerprintSha256: fingerprint } }));
    expect(await probe(port)).toEqual({
      code: 0,
      signal: null,
      stdout: "capacitylens-internal-tls: coordinated renewal verified\n",
      stderr: "",
    });
  });

  it.each([300, 404, 503])("rejects status %i even with a matching fingerprint", async (status) => {
    const port = await listen(status, JSON.stringify({ internalTls: { fingerprintSha256: fingerprint } }));
    expect(await probe(port)).toMatchObject({
      code: 1,
      signal: null,
      stdout: "",
      stderr: expect.stringContaining("live fingerprint does not match the published generation"),
    });
  });

  it.each([
    {},
    { internalTls: null },
    { internalTls: {} },
    { internalTls: { fingerprintSha256: "b".repeat(64) } },
    { internalTls: { fingerprintSha256: 42 } },
    { internalTls: { fingerprintSha256: `${fingerprint}\n` } },
  ])("rejects a missing, malformed or different fingerprint: %j", async (health) => {
    const port = await listen(200, JSON.stringify(health));
    expect(await probe(port)).toMatchObject({
      code: 1,
      signal: null,
      stdout: "",
      stderr: expect.stringContaining("renewal verification failed"),
    });
  });

  it.each(["", "null", "not json"])("reports invalid response data: %j", async (body) => {
    expect(await probe(await listen(200, body))).toMatchObject({
      code: 1,
      signal: null,
      stdout: "",
      stderr: expect.stringContaining("renewal verification failed"),
    });
  });

  it("reports a connection failure without reporting renewal success", async () => {
    const port = await listen(200, "{}");
    await closeServer();
    expect(await probe(port)).toMatchObject({
      code: 1,
      signal: null,
      stdout: "",
      stderr: expect.stringContaining("renewal verification failed"),
    });
  });

  it.each([
    { marker: null, message: "ERR_INVALID_ARG_TYPE" },
    { marker: "missing", message: "ENOENT" },
  ])("fails before contacting the service when the marker is $marker", async ({ marker, message }) => {
    expect(await probe("1", marker === null ? null : join(directory, marker))).toMatchObject({
      code: 1,
      signal: null,
      stdout: "",
      stderr: expect.stringContaining(message),
    });
  });
});
