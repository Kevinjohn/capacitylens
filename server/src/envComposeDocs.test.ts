import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const envExample = readFileSync(fileURLToPath(new URL("../../.env.example", import.meta.url)), "utf8");
const compose = readFileSync(fileURLToPath(new URL("../../docker-compose.yml", import.meta.url)), "utf8");
const dockerfile = readFileSync(fileURLToPath(new URL("../../Dockerfile", import.meta.url)), "utf8");

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
});
