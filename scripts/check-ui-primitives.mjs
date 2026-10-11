import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const mcpManifest = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));
const registryPin = packageManifest.scripts["ui:registry"].match(/shadcn@([^\s]+)/)?.[1];
const mcpPin = mcpManifest.mcpServers.shadcn.args.find((argument) => argument.startsWith("shadcn@"))?.slice(7);
if (!registryPin || registryPin !== mcpPin) {
  console.error(`shadcn tooling versions differ: registry=${registryPin ?? "missing"}, MCP=${mcpPin ?? "missing"}`);
  process.exit(1);
}

const sourceOwnedPrimitives = {
  "src/components/ui/alert-dialog.tsx": "273382747aad1d469a774b70f2c7dde4ff612549ac5917be545c8525f8e0aac8",
  "src/components/ui/alert.tsx": "248d52724d2f881e62aafb0b99212eb43f0469d03bced431dc282485b87344ba",
  "src/components/ui/avatar.tsx": "0139f24b1b0cd085d3f9a8e58363317e54fb1e059c778d9b9073b3d7999a952d",
  "src/components/ui/badge.tsx": "0d7ff98483b43634c32a873ff7d7be60929a922362e9ef852072bc22f6823ae6",
  "src/components/ui/button.tsx": "1baae11e67b9d548f3c538dfdc6ae25c5edc84d42188d98fd708fc35d175cc05",
  "src/components/ui/dialog.tsx": "f1bafa06701b857f6d6f93bf58f394930dfd44a1a5946961dce5c82a2869da36",
  "src/components/ui/empty.tsx": "e6966082b4736bdd01cbb874a908360d7f6795e3158d446ede0fcb3f10df832d",
  "src/components/ui/item.tsx": "ea2af620f8d88eeecad2fe0976a1d720869f002f11a96d0ccbcdb495a2682064",
  "src/components/ui/popover.tsx": "d1a4b8d715144227a0719d54b00d377f4750542f70551074cf939cce7a52c40f",
  "src/components/ui/select.tsx": "161de554ec8f384a3952c93fda760344c41840111144fd3e7c39b3c883995a70",
  "src/components/ui/sheet.tsx": "6a4cbc17fea3fd3c6dca40c65ba7e9c75be6fef95eb4609326a36e7fb690a846",
  "src/components/ui/sidebar.tsx": "e3a7ed34ac19b5a022c1b5969d771c2bdc7e8e14332fddea26e696d2e2da2fda",
  "src/components/ui/toggle.tsx": "ca13c0cc45a5951155d7d321d782ef91bd5f68c0a623af1bdbd9288212238aa0",
  "src/components/ui/toggle-group.tsx": "c13b73081fc00c367bc22de16799071d9e7616448d8cc05240484384ff9c0210",
  "src/components/ui/tooltip.tsx": "fe764c92061ac7f974fb4a66e7451af7b20024660ed51ebf147aded491ed8192",
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

console.log(
  `UI primitive contract verified (${Object.keys(sourceOwnedPrimitives).length} source-owned files; shadcn ${registryPin}).`,
);
