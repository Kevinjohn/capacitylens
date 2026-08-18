import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePort } from "./scripts/port.mjs";
import { clientApiOrigin } from "./scripts/render-client-nginx.mjs";
import { isAccountEmail } from "./shared/src/account/validation";

const devApiPort = parsePort(process.env.CAPACITYLENS_DEV_API_PORT, 8787, "CAPACITYLENS_DEV_API_PORT");
const STATIC_SPA_ROUTES = [
  "resources",
  "external",
  "disciplines",
  "clients",
  "projects",
  "activities",
  "timeoff",
  "team",
  "settings",
] as const;

function offlineShellManifest(): Plugin {
  return {
    name: "capacitylens-offline-shell-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((fileName) => fileName !== "offline-shell.json" && !fileName.endsWith(".html"))
        .map((fileName) => `/${fileName}`)
        .sort();
      this.emitFile({
        type: "asset",
        fileName: "offline-shell.json",
        source: JSON.stringify(assets),
      });
    },
  };
}

/**
 * Emit real directory index documents for fixed client routes. The packaged nginx image still
 * provides the normal SPA fallback, while these aliases also survive a static outer proxy that
 * serves only paths which physically exist (the production failure mode this guards).
 */
function staticSpaRouteDocuments(): Plugin {
  let outputDirectory = "";
  return {
    name: "capacitylens-static-spa-route-documents",
    apply: "build",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const shell = resolve(outputDirectory, "index.html");
      for (const route of STATIC_SPA_ROUTES) {
        const directory = resolve(outputDirectory, route);
        await mkdir(directory, { recursive: true });
        await copyFile(shell, resolve(directory, "index.html"));
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "VITE_CAPACITYLENS_");
  const clientEnv = (name: "VITE_CAPACITYLENS_API" | "VITE_CAPACITYLENS_DEMO" | "VITE_CAPACITYLENS_FEEDBACK_MAILTO") =>
    process.env[name] ?? fileEnv[name] ?? "";
  clientApiOrigin(clientEnv("VITE_CAPACITYLENS_API"), clientEnv("VITE_CAPACITYLENS_DEMO"));
  const feedbackAddress = clientEnv("VITE_CAPACITYLENS_FEEDBACK_MAILTO").trim();
  if (feedbackAddress !== "" && !isAccountEmail(feedbackAddress)) {
    throw new Error("VITE_CAPACITYLENS_FEEDBACK_MAILTO must be one valid email address.");
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      offlineShellManifest(),
      staticSpaRouteDocuments(),
      // Paraglide (inlang) i18n (P1.5.1) — compile-time, type-safe messages. The plugin re-runs the
      // message compiler into ./src/paraglide on dev/build (the package scripts also precompile so a
      // bare `tsc -b`/`vitest` finds the output). strategy = ['globalVariable','baseLocale']: locale is
      // account-scoped + client-only (set from Account.language via src/i18n), so it lives in a global
      // variable with NO page reload — NOT a cookie (which would imply a server round-trip / reload).
      // baseLocale is the fallback. English-only today; the seam is in place for later locales (P1.5.2+).
      paraglideVitePlugin({
        project: "./project.inlang",
        outdir: "./src/paraglide",
        strategy: ["globalVariable", "baseLocale"],
      }),
    ],
    resolve: {
      alias: {
        "@capacitylens/shared": fileURLToPath(new URL("./shared/src", import.meta.url)),
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    // Bind IPv4 loopback explicitly. Node 17+ resolves `localhost` to `::1` (IPv6)
    // first, so the default Vite host would listen on `::1` only and any browser/tool
    // reaching `127.0.0.1` gets connection-refused (blank page, no console error).
    // Pinning 127.0.0.1 keeps it loopback-only while staying reachable as `localhost`.
    // (Use `host: true` instead if you need to reach the dev server from another device.)
    // strictPort: if 5173 is already taken (for example by a stale development server), FAIL LOUDLY instead of
    // silently starting on 5174 while the browser stares at the wrong port's white page.
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      // Dev-only /api proxy for the full-stack `pnpm run dev` (scripts/dev-fullstack.mjs): the app
      // talks to a same-origin /api and Vite forwards it to the SQLite server on :8787 (one rule
      // also covers /api/auth/*). Irrelevant to the demo build (no /api calls) and to prod (nginx
      // does this); ignored by `vite build`. Stays in lockstep with the launcher via the same env var.
      proxy: {
        "/api": {
          // Keep this `CAPACITYLENS_DEV_API_PORT ?? 8787` default identical to scripts/dev-fullstack.mjs's
          // API_PORT so the launcher and this proxy stay in lockstep (the 8787 is the shared default).
          target: `http://localhost:${devApiPort}`,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: "jsdom",
      env: { TZ: "UTC" },
      setupFiles: ["./src/test/setup.ts"],
      css: true,
      include: ["src/**/*.{test,spec}.{ts,tsx}", "shared/**/*.{test,spec}.ts"],
      exclude: ["e2e/**", "node_modules/**", "dist/**"],
      coverage: {
        provider: "v8",
        reporter: ["text-summary", "html", "lcov"],
        include: ["src/**/*.{ts,tsx}", "shared/src/**/*.ts"],
        exclude: [
          "**/*.test.{ts,tsx}",
          "src/test/**",
          "src/main.tsx",
          "src/router.tsx",
          "src/vite-env.d.ts",
          // Paraglide-generated message/runtime code (P1.5.1) — not hand-written, not under test.
          "src/paraglide/**",
        ],
        // Ratcheted 2026-08-18 against a measured 94.15% statements / 89.34% branches /
        // 93.86% functions / 96.11% lines; kept just below so the gate catches
        // regressions without flaking on small refactors.
        thresholds: {
          statements: 92,
          branches: 87,
          functions: 92,
          lines: 94,
        },
      },
    },
  };
});
