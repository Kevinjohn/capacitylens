// Production-shaped local rehearsal server: static dist/ plus same-origin /api proxying.
import { createServer, request as httpRequest } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { parsePort } from "./port.mjs";

const DEFAULT_DIST = join(process.cwd(), "dist");
export const REHEARSAL_UPSTREAM_TIMEOUT_MS = 130_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};
const FILE_LIKE_PATH = /\.(?:css|js|mjs|json|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|txt|xml|webmanifest)$/i;

const missing = (error) => error && typeof error === "object" && error.code === "ENOENT";

export function createRehearsalRequestHandler({
  dist = DEFAULT_DIST,
  apiPort = 8787,
  upstreamTimeoutMs = REHEARSAL_UPSTREAM_TIMEOUT_MS,
  statPath = stat,
  openFile = createReadStream,
  report = console.error,
} = {}) {
  return (req, res) => {
    if (req.url?.startsWith("/api/")) {
      let timedOut = false;
      let failed = false;
      const fail = (status, error) => {
        if (failed) return;
        failed = true;
        if (error) report("serve-dist: upstream request failed", error);
        if (res.destroyed) return;
        if (res.headersSent) res.destroy(error);
        else if (!res.writableEnded) {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(status === 504 ? '{"error":"upstream timeout"}' : '{"error":"upstream unavailable"}');
        }
      };
      const upstream = httpRequest(
        { host: "127.0.0.1", port: apiPort, path: req.url, method: req.method, headers: req.headers },
        (up) => {
          up.setTimeout(upstreamTimeoutMs, () => {
            timedOut = true;
            const error = new Error("upstream response timed out");
            up.destroy(error);
            upstream.destroy(error);
            fail(504, error);
          });
          up.on("aborted", () => {
            const error = new Error("upstream response aborted");
            upstream.destroy(error);
            fail(502, error);
          });
          up.on("error", (error) => fail(timedOut ? 504 : 502, error));
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.setTimeout(upstreamTimeoutMs, () => {
        timedOut = true;
        const error = new Error("upstream request timed out");
        upstream.destroy(error);
        fail(504, error);
      });
      upstream.on("error", (error) => fail(timedOut ? 504 : 502, error));
      req.on("aborted", () => upstream.destroy(new Error("downstream request aborted")));
      res.on("close", () => {
        if (!res.writableEnded) upstream.destroy(new Error("downstream response closed"));
      });
      req.pipe(upstream);
      return;
    }

    const path = normalize((req.url ?? "/").split("?")[0]).replace(/^([.][.][/\\])+/, "");
    const requested = path === "/" ? join(dist, "index.html") : join(dist, path);
    const respondMissing = (fallbackAllowed) => {
      if (fallbackAllowed) void serve(join(dist, "index.html"), false);
      else {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("404 not found");
      }
    };
    const respondFault = (error) => {
      report("serve-dist: static file failed", error);
      if (res.headersSent) res.destroy(error);
      else {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("500 static file failure");
      }
    };
    const serve = async (target, fallbackAllowed) => {
      try {
        if (!(await statPath(target)).isFile()) {
          respondMissing(fallbackAllowed);
          return;
        }
      } catch (error) {
        if (missing(error)) respondMissing(fallbackAllowed);
        else respondFault(error);
        return;
      }
      const stream = openFile(target);
      stream.once("open", () => {
        res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream" });
        stream.pipe(res);
      });
      stream.on("error", (error) => {
        if (missing(error)) respondMissing(fallbackAllowed);
        else respondFault(error);
      });
    };
    void serve(requested, !path.startsWith("/assets/") && !FILE_LIKE_PATH.test(path));
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const port = parsePort(process.env.PORT, 4173, "PORT");
  const apiPort = parsePort(process.env.API_PORT, 8787, "API_PORT");
  if (!existsSync(join(DEFAULT_DIST, "index.html"))) {
    console.error("serve-dist: no dist/index.html — run the production build first (see runbook).");
    process.exit(1);
  }
  createServer(createRehearsalRequestHandler({ apiPort })).listen(port, "127.0.0.1", () => {
    console.log(`serve-dist: http://127.0.0.1:${port} (dist/ + /api → 127.0.0.1:${apiPort})`);
  });
}
