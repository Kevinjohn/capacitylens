import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const inventoryPath = "docs/security/crypto-inventory.json";
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const reviewed = new Set(inventory.entries.map((entry) => entry.path));

function gitFiles(args) {
  const listed = spawnSync("git", ["ls-files", ...args], { encoding: "utf8" });
  if (listed.status !== 0) {
    console.error(listed.stderr || "Unable to enumerate repository files for cryptographic discovery.");
    process.exit(1);
  }
  return listed.stdout.split("\n").filter(Boolean);
}

const trackedFiles = gitFiles(["--cached"]);
const untrackedFiles = gitFiles(["--others", "--exclude-standard"]);

const excluded =
  /(?:^|\/)(?:node_modules|reports|coverage|dist|src\/paraglide|to-my-siblings)(?:\/|$)|(?:\.test|\.spec)\.[cm]?[jt]sx?$|^scripts\/check-crypto-inventory\.mjs$|^docs\/security\/crypto-inventory\.json$/;
const eligible = /(?:\.[cm]?[jt]sx?|\.sh|\.conf|\.ya?ml|\.json|\.sql|\.py)$/;
const markers = [
  /(?:from|require\()['"]node:crypto/,
  /from\s+['"]jose['"]/,
  /\bcrypto\.(?:subtle|randomUUID|getRandomValues)\s*\(?/,
  /\b(?:AES-GCM|scrypt|timingSafeEqual|createHash|createHmac|randomBytes)\b/,
  /\bopenssl\b/,
  /\bproxy_ssl_(?:verify|trusted_certificate|protocols|name)\b/,
  /CAPACITYLENS_INTERNAL_TLS_(?:CERT|KEY|CA)/,
  /\bloadInternalTls\s*\(/,
  /minVersion:\s*['"]TLSv/,
];

function discover(files) {
  const discovered = new Set();
  for (const path of files) {
    if (excluded.test(path) || !(eligible.test(path) || /(?:^|\/)Dockerfile(?:\.|$)/.test(path))) continue;
    // `git ls-files --cached` includes tracked files deleted in the working tree. Treat their absence
    // as the intended candidate state so the gate can validate a deletion before it is staged.
    if (!existsSync(path)) continue;
    const extension = path.slice(path.lastIndexOf("."));
    const raw = readFileSync(path, "utf8");
    const source = /\.(?:[cm]?[jt]sx?)$/.test(extension)
      ? raw.replace(/(?<!:)\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
      : /\.(?:sh|conf|ya?ml|py)$/.test(extension)
        ? raw.replace(/#.*$/gm, "")
        : raw;
    if (markers.some((marker) => marker.test(source))) discovered.add(path);
  }
  return discovered;
}

const discovered = discover(trackedFiles);
const untrackedDiscovered = discover(untrackedFiles);
if (untrackedDiscovered.size > 0) {
  console.warn(
    `Untracked crypto-like files are outside the inventory gate and were ignored:\n  ${[...untrackedDiscovered].sort().join("\n  ")}`,
  );
}

const unreviewed = [...discovered].filter((path) => !reviewed.has(path)).sort();
const stale = [...reviewed].filter((path) => !discovered.has(path)).sort();
if (unreviewed.length > 0 || stale.length > 0) {
  if (unreviewed.length > 0) {
    console.error(`Unreviewed cryptographic implementation paths:\n  ${unreviewed.join("\n  ")}`);
  }
  if (stale.length > 0) {
    console.error(`Stale cryptographic inventory paths:\n  ${stale.join("\n  ")}`);
  }
  console.error(`Update ${inventoryPath} after reviewing the algorithms, keys, purpose and lifecycle.`);
  process.exit(1);
}

console.log(`Cryptographic discovery: ${discovered.size} implementation paths match the reviewed inventory.`);
