import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CONNECT_SOURCES_PLACEHOLDER = "__CAPACITYLENS_CONNECT_SOURCES__";

export function clientApiOrigin(apiValue, demoValue) {
  if (demoValue === "1") return null;
  const raw = apiValue.trim().replace(/\/+$/, "");
  if (raw === "") return null;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error("VITE_CAPACITYLENS_API must be an absolute HTTP(S) origin.", { cause: error });
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("VITE_CAPACITYLENS_API must be an HTTP(S) origin without credentials, path, query or fragment.");
  }
  return parsed.origin;
}

export function renderClientNginx(template, env = process.env) {
  const occurrences = template.split(CONNECT_SOURCES_PLACEHOLDER).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Client nginx template must contain exactly one ${CONNECT_SOURCES_PLACEHOLDER} placeholder.`);
  }
  if (env.VITE_CAPACITYLENS_DEMO !== "1" && (env.VITE_CAPACITYLENS_API ?? "").trim() === "") {
    throw new Error(
      "The client-only image requires VITE_CAPACITYLENS_DEMO=1 or a remote VITE_CAPACITYLENS_API origin.",
    );
  }
  const apiOrigin = clientApiOrigin(env.VITE_CAPACITYLENS_API ?? "", env.VITE_CAPACITYLENS_DEMO ?? "");
  const connectSources = `'self'${apiOrigin === null ? "" : ` ${apiOrigin}`}`;
  return template.replace(CONNECT_SOURCES_PLACEHOLDER, JSON.stringify(connectSources));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [templatePath, outputPath] = process.argv.slice(2);
  if (!templatePath || !outputPath) {
    throw new Error("Usage: node scripts/render-client-nginx.mjs <template> <output>");
  }
  writeFileSync(outputPath, renderClientNginx(readFileSync(templatePath, "utf8")));
}
