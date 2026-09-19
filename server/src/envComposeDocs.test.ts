import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const envExample = readFileSync(fileURLToPath(new URL("../../.env.example", import.meta.url)), "utf8");
const compose = readFileSync(fileURLToPath(new URL("../../docker-compose.yml", import.meta.url)), "utf8");
const dockerfile = readFileSync(fileURLToPath(new URL("../../Dockerfile", import.meta.url)), "utf8");
const managedConfigure = readFileSync(
  fileURLToPath(new URL("../../docs-src/self-hosting/managed-vps/configure-the-api-and-nginx.md", import.meta.url)),
  "utf8",
);
const managedDeploy = readFileSync(
  fileURLToPath(new URL("../../docs-src/self-hosting/managed-vps/deploy-and-upgrade-safely.md", import.meta.url)),
  "utf8",
);
const bareMetalInstall = readFileSync(
  fileURLToPath(new URL("../../docs-src/self-hosting/install-without-docker.md", import.meta.url)),
  "utf8",
);
const nginxConf = readFileSync(fileURLToPath(new URL("../../nginx.conf", import.meta.url)), "utf8");
const dockerIgnore = readFileSync(fileURLToPath(new URL("../../.dockerignore", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("./routes/appLogging.ts", import.meta.url)), "utf8");

/** The invite sub-actions whose bearer rides in the URL path, as enumerated at a `.../(a|b|c)` site. */
const inviteActionsAt = (source: string, anchor: RegExp): string[] => {
  const alternation = source.match(anchor);
  const actions = alternation?.[1];
  return actions ? [...new Set(actions.split("|").map((value) => value.trim()))].sort() : [];
};

const registerOidcBrandComposeTest = (): void => {
  it("passes the documented OIDC presentation brand settings into the API container", () => {
    const apiService = compose.split("\n  api:\n")[1]?.split("\n  web:\n")[0];
    expect(apiService).toBeDefined();
    const apiLines = apiService?.split("\n").map((line) => line.trim());

    for (const name of ["SMALLSASS_ACCOUNT_OIDC_BRAND", "CAPACITYLENS_SSO_BRAND"]) {
      expect(envExample).toContain(name);
      expect(apiLines).toContain(`${name}: ${"${"}${name}:-}`);
    }
  });
};

describe("Compose exceptions in the environment register", () => {
  it("documents runtime values that Compose pins to its private network and durable volume", () => {
    expect(envExample).toMatch(/Compose pins this to 8787[\s\S]*?PORT=8787/);
    expect(envExample).toMatch(
      /Compose pins this to \/data\/capacitylens\.db[\s\S]*?CAPACITYLENS_DB=\/data\/capacitylens\.db/,
    );
    expect(compose).toMatch(/PORT:\s*"8787"/);
    expect(compose).toMatch(/CAPACITYLENS_DB:\s*\/data\/capacitylens\.db/);
  });

  it("documents development-only values deliberately omitted from the production container", () => {
    for (const name of ["CAPACITYLENS_ALLOW_RESET", "CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD"]) {
      expect(envExample).toMatch(
        new RegExp(
          `Compose (?:deliberately )?does\\n?#? ?not pass[\\s\\S]*?${name}|${name}[\\s\\S]*?Compose (?:deliberately )?does\\n?#? ?not pass`,
        ),
      );
      expect(compose).not.toMatch(new RegExp(`^\\s+${name}:`, "m"));
    }
  });

  registerOidcBrandComposeTest();

  it("keeps production mode out of Vite-loaded env files and sets it on the API process", () => {
    expect(envExample).toMatch(/Node environment is set on the API process for bare-metal runs/);
    expect(envExample).not.toMatch(/^NODE_ENV=/m);
    expect(compose).not.toMatch(/^\s+NODE_ENV:/m);
    expect(dockerfile).toMatch(/^ENV NODE_ENV=production$/m);
    expect(managedConfigure).toMatch(
      /source \.env; set \+a; exec env NODE_ENV=production node server\/dist\/index\.mjs/,
    );
    expect(managedConfigure).not.toMatch(/^NODE_ENV=production$/m);
    expect(bareMetalInstall).toMatch(/^\s+Environment=NODE_ENV=production$/m);
    expect(managedDeploy).toMatch(/Keep `NODE_ENV=production` on the API process/);
  });

  it("builds the API runtime ahead of time instead of transforming TypeScript at startup", () => {
    expect(dockerfile).toContain("pnpm --filter capacitylens-server run build:runtime");
    expect(dockerfile).toContain("exec node dist/index.mjs");
    expect(dockerfile).not.toContain("exec node_modules/.bin/tsx");
  });

  it("documents the web image as the default Dockerfile target", () => {
    const stages = [...dockerfile.matchAll(/^FROM\s+\S+(?:\s+AS\s+(\S+))?$/gim)];
    expect(stages.at(-1)?.[1]).toBe("web");
    expect(dockerfile).toMatch(/web image as the Dockerfile's final\/default target/i);
    expect(dockerfile).toMatch(/select the\s+#?\s*`api` target explicitly/i);
  });

  it("suppresses the nginx access log for exactly the invite bearers the app redacts", () => {
    // The invite token rides in the request path (preview, accept, signup). Its capability must be
    // kept out of logs at every hop, so nginx's `access_log off` location and the app's log-redaction
    // regex must cover the identical action set — coupling them here means a future token-scoped
    // invite route that lands in one list but not the other fails this test instead of leaking.
    const nginxActions = inviteActionsAt(
      nginxConf,
      /location\s+~\s+\^\/api\/invites\/\[\^\/\]\+\/\(([^)]+)\)\$\s*\{[^}]*access_log\s+off;/,
    );
    const appActions = inviteActionsAt(appSource, /INVITE_OPERATION_URL_RE\s*=[^\n]*\(\?:([^)]+)\)/);
    expect(nginxActions, "nginx invite access_log-off actions").toContain("preview");
    expect(appActions, "app INVITE_OPERATION_URL_RE actions").not.toHaveLength(0);
    expect(nginxActions).toEqual(appActions);
  });

  it("keeps private local reference material out of the Docker build context", () => {
    const ignoredLines = dockerIgnore.split("\n").map((line) => line.trim());
    for (const path of ["/_input/", "/to-my-siblings/"]) {
      expect(ignoredLines, path).toContain(path);
    }
  });
});
