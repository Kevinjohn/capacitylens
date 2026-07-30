import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const sourceOwnedPrimitives = {
  "src/components/ui/alert-dialog.tsx": "1a4d81da3c939c2a33d1203f11e2ab08af6d8c2bf82652e53631703062eb58d0",
  "src/components/ui/alert.tsx": "cb5b6abff8315ab84bbdd44350d0faf955b5934e0b16170bb14e17f81534f3fa",
  "src/components/ui/badge.tsx": "73ecb22f7de789caa013d8231a20dfa1d6bba4409c72a7718d9e8b3da2b6f597",
  "src/components/ui/button.tsx": "b55c92749d58f8ef7fb1117701ce0a2a82a50f08a12bbbe176b9ac32d886160f",
  "src/components/ui/dialog.tsx": "fc521cf423594efcdc8998cb589721b0a3cdcd064a633268c493d27050587d44",
  "src/components/ui/toggle-group.tsx": "9bb5d6398667d61659066bfc314162e53be7a4cc7b306f80b92f1602855c156b",
  "src/components/ui/tooltip.tsx": "d632591991d536580cc23c5429416bff2073a8b5ecbfc6dc24c5055bbb7fd877",
};

const changed = [];
for (const [path, expected] of Object.entries(sourceOwnedPrimitives)) {
  const source = await readFile(new URL(`../${path}`, import.meta.url));
  const actual = createHash("sha256").update(source).digest("hex");
  if (actual !== expected) changed.push(path);
}

if (changed.length > 0) {
  console.error(
    [
      "Source-owned UI primitive contract changed:",
      ...changed.map((path) => `- ${path}`),
      "Review the pinned registry dry-run, preserve documented local behaviour, then update this contract deliberately.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`UI primitive contract verified (${Object.keys(sourceOwnedPrimitives).length} source-owned files).`);
