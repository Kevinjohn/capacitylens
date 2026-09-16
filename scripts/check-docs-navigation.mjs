import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = resolve(dirname(fileURLToPath(import.meta.url)), "../docs");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });

const htmlFiles = walk(siteDir).filter((file) => file.endsWith(".html"));
const sidebarTargets = new Set();

const resolvesTo = (href, pageFile) => {
  const target = href.split("#", 1)[0];
  return target && resolve(dirname(pageFile), target) === pageFile;
};

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  const sidebar = html.match(/<aside class="VPSidebar"[\s\S]*?<\/aside>/)?.[0];
  if (!sidebar) continue;

  for (const [, href] of sidebar.matchAll(/<a class="VPLink link link" href="([^"]+)"/g)) {
    const target = href.split("#", 1)[0];
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    const targetFile = resolve(dirname(file), target);
    if (targetFile.startsWith(`${siteDir}${sep}`) && existsSync(targetFile)) sidebarTargets.add(targetFile);
  }
}

const failures = [];
if (sidebarTargets.size === 0) {
  failures.push("no sidebar-linked pages were found");
}

for (const targetFile of sidebarTargets) {
  const html = readFileSync(targetFile, "utf8");
  const sidebar = html.match(/<aside class="VPSidebar"[\s\S]*?<\/aside>/)?.[0] ?? "";
  const sidebarCurrent = [...sidebar.matchAll(/<a class="VPLink link link" href="([^"]+)"[^>]*aria-current="page"/g)];
  const correctSidebarCurrent = sidebarCurrent.filter(([, href]) => resolvesTo(href, targetFile)).length;
  if (sidebarCurrent.length !== 1 || correctSidebarCurrent !== 1) {
    failures.push(
      `${relative(siteDir, targetFile)}: expected one current sidebar link to this page, found ${sidebarCurrent.length}`,
    );
  }

  const guide = html.match(/<details class="guide-navigation">[\s\S]*?<\/details>/)?.[0];
  if (guide) {
    const guideCurrent = [...guide.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*aria-current="page"/g)];
    const correctGuideCurrent = guideCurrent.filter(([, href]) => resolvesTo(href, targetFile)).length;
    if (guideCurrent.length !== 1 || correctGuideCurrent !== 1) {
      failures.push(
        `${relative(siteDir, targetFile)}: expected one current native guide link to this page, found ${guideCurrent.length}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`docs navigation check failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

console.log(`docs navigation check passed: ${sidebarTargets.size} sidebar-linked pages have current markers.`);
