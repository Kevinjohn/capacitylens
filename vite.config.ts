import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { fileURLToPath } from "node:url";
import { parsePort } from "./scripts/port.mjs";
import { clientApiOrigin } from "./scripts/render-client-nginx.mjs";
import { isAccountEmail } from "./shared/src/account/validation";

const devApiPort = parsePort(process.env.CAPACITYLENS_DEV_API_PORT, 8787, "CAPACITYLENS_DEV_API_PORT");

function offlineShellManifest(): Plugin {
  return {
    name: "capacitylens-offline-shell-manifest",
    apply: "build",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((fileName) => fileName !== "offline-shell.json" && fileName !== "index.html")
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
        thresholds: {
          statements: 84,
          branches: 78,
          functions: 85,
          lines: 86,
        },
      },
    },
  };
});
