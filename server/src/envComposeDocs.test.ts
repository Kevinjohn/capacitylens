import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const envExample = readFileSync(fileURLToPath(new URL("../../.env.example", import.meta.url)), "utf8");
const compose = readFileSync(fileURLToPath(new URL("../../docker-compose.yml", import.meta.url)), "utf8");
const dockerfile = readFileSync(fileURLToPath(new URL("../../Dockerfile", import.meta.url)), "utf8");
const nginxConf = readFileSync(fileURLToPath(new URL("../../nginx.conf", import.meta.url)), "utf8");
const dockerIgnore = readFileSync(fileURLToPath(new URL("../../.dockerignore", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");

/** The invite sub-actions whose bearer rides in the URL path, as enumerated at a `.../(a|b|c)` site. */
const inviteActionsAt = (source: string, anchor: RegExp): string[] => {
  const alternation = source.match(anchor);
  return alternation ? [...new Set(alternation[1].split("|").map((value) => value.trim()))].sort() : [];
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

  it("documents that the image, rather than Compose or .env interpolation, fixes production mode", () => {
    expect(envExample).toMatch(
      /Node environment for bare-metal runs\. Compose does not pass this setting into the container;[\s\S]*?NODE_ENV=production/,
    );
    expect(compose).not.toMatch(/^\s+NODE_ENV:/m);
    expect(dockerfile).toMatch(/^ENV NODE_ENV=production$/m);
  });

  it("selects the API healthcheck scheme from the same certificate/key pair as the listener", () => {
    const healthcheck = dockerfile.match(/HEALTHCHECK[\s\S]*?\n\s*CMD node -e "([^"]+)"/)?.[1] ?? "";

    expect(healthcheck).toContain("if(!cert&&!key)");
    expect(healthcheck).toContain("fetch('http://127.0.0.1:'");
    expect(healthcheck).toContain("https.get(");
    expect(healthcheck).toContain("ca?{ca:fs.readFileSync(ca),servername:'api'}:{rejectUnauthorized:false}");
  });

  it("builds the API runtime ahead of time instead of transforming TypeScript at startup", () => {
    expect(dockerfile).toContain("pnpm --filter capacitylens-server run build:runtime");
    expect(dockerfile).toContain("exec node dist/index.mjs");
    expect(dockerfile).not.toContain("exec node_modules/.bin/tsx");
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
    for (const path of ["/_input/", "/to-my-siblings/"]) {
      expect(dockerIgnore, path).toMatch(new RegExp(`^${path.replace(/[/]/g, "\\/")}$`, "m"));
    }
  });
});
