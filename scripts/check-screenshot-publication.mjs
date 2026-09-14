import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reviewPath = resolve(repositoryRoot, "docs-src/screenshots/publication-review.json");

export function validateReviewedScreenshots(root, entries) {
  const failures = [];
  for (const entry of entries) {
    const imagePath = resolve(root, entry.path);
    if (!existsSync(imagePath)) {
      failures.push(`${entry.path} is missing.`);
      continue;
    }
    const actual = createHash("sha256").update(readFileSync(imagePath)).digest("hex");
    if (actual !== entry.sha256) {
      failures.push(
        `${entry.path} changed after its bearer-value publication review; inspect it and update the reviewed SHA-256.`,
      );
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const entries = JSON.parse(readFileSync(reviewPath, "utf8"));
  const failures = validateReviewedScreenshots(repositoryRoot, entries);
  if (failures.length > 0) {
    console.error(`Screenshot publication review failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${entries.length} sensitive screenshot publication review pin passed.`);
}
