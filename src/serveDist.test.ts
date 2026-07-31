import { createServer, get as httpGet, request as httpRequest, type RequestListener, type Server } from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRehearsalRequestHandler } from "../scripts/serve-dist.mjs";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function listen(handler: RequestListener): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no TCP port");
  return { server, port: address.port };
}

const requestText = (port: number, path: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    httpGet({ host: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    }).on("error", reject);
  });

describe("serve-dist rehearsal boundary", () => {
  it("times out an upstream that accepts a request but never sends headers", async () => {
    let upstreamClosed!: Promise<void>;
    const upstream = await listen((request) => {
      upstreamClosed = new Promise((resolve) => request.once("close", resolve));
    });
    const report = vi.fn();
    const proxy = await listen(
      createRehearsalRequestHandler({ apiPort: upstream.port, upstreamTimeoutMs: 30, report }),
    );

    await expect(requestText(proxy.port, "/api/health")).resolves.toEqual({
      status: 504,
      body: '{"error":"upstream timeout"}',
    });
    await upstreamClosed;
    expect(report).toHaveBeenCalledWith("serve-dist: upstream request failed", expect.any(Error));
  });

  it("destroys the upstream leg when the downstream client disconnects", async () => {
    let markReceived!: () => void;
    const upstreamReceived = new Promise<void>((resolve) => (markReceived = resolve));
    let upstreamClosed!: Promise<void>;
    const upstream = await listen((request) => {
      markReceived();
      upstreamClosed = new Promise((resolve) => request.once("close", resolve));
    });
    const proxy = await listen(createRehearsalRequestHandler({ apiPort: upstream.port, upstreamTimeoutMs: 1_000 }));
    const request = httpRequest({ host: "127.0.0.1", port: proxy.port, path: "/api/health" });
    request.on("error", () => undefined);
    request.end();
    await upstreamReceived;
    request.destroy();

    await upstreamClosed;
  });

  it("aborts a stalled mid-body response and releases the upstream socket", async () => {
    let upstreamClosed!: Promise<void>;
    const upstream = await listen((request, response) => {
      upstreamClosed = new Promise((resolve) => request.once("close", resolve));
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("partial");
    });
    const proxy = await listen(
      createRehearsalRequestHandler({ apiPort: upstream.port, upstreamTimeoutMs: 30, report: () => undefined }),
    );

    await new Promise<void>((resolve, reject) => {
      httpGet({ host: "127.0.0.1", port: proxy.port, path: "/api/stalled" }, (response) => {
        response.on("aborted", resolve);
        response.on("error", resolve);
        response.on("end", () => reject(new Error("stalled response ended successfully")));
        response.resume();
      }).on("error", reject);
    });
    await upstreamClosed;
  });

  it("keeps genuine misses as 404 without hiding an unexpected stat fault", async () => {
    const missingError = Object.assign(new Error("missing"), { code: "ENOENT" });
    const missingReport = vi.fn();
    const missing = await listen(
      createRehearsalRequestHandler({
        dist: "/dist",
        statPath: async () => Promise.reject(missingError),
        report: missingReport,
      }),
    );
    await expect(requestText(missing.port, "/assets/missing.js")).resolves.toMatchObject({ status: 404 });
    expect(missingReport).not.toHaveBeenCalled();

    const directory = await listen(
      createRehearsalRequestHandler({
        dist: "/dist",
        statPath: async () => ({ isFile: () => false }),
        report: missingReport,
      }),
    );
    await expect(requestText(directory.port, "/assets/directory.js")).resolves.toMatchObject({ status: 404 });
    expect(missingReport).not.toHaveBeenCalled();

    const fault = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const faultReport = vi.fn();
    const broken = await listen(
      createRehearsalRequestHandler({
        dist: "/dist",
        statPath: async () => Promise.reject(fault),
        report: faultReport,
      }),
    );
    await expect(requestText(broken.port, "/assets/app.js")).resolves.toMatchObject({ status: 500 });
    expect(faultReport).toHaveBeenCalledWith("serve-dist: static file failed", fault);
  });

  it("surfaces a post-stat stream fault as 500 with its cause", async () => {
    const fault = Object.assign(new Error("storage I/O failed"), { code: "EIO" });
    const report = vi.fn();
    const server = await listen(
      createRehearsalRequestHandler({
        dist: "/dist",
        statPath: async () => ({ isFile: () => true }),
        openFile: () => {
          const stream = new PassThrough();
          queueMicrotask(() => stream.emit("error", fault));
          return stream;
        },
        report,
      }),
    );

    await expect(requestText(server.port, "/assets/app.js")).resolves.toMatchObject({ status: 500 });
    expect(report).toHaveBeenCalledWith("serve-dist: static file failed", fault);
  });
});
