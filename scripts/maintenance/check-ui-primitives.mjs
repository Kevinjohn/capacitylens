import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const mcpManifest = JSON.parse(await readFile(new URL('../../.mcp.json', import.meta.url), 'utf8'));
const registryCommand = await readFile(new URL('./ui-registry.mjs', import.meta.url), 'utf8');
const registryPin = registryCommand.match(/shadcn@([^\s"']+)/)?.[1];
const mcpPin = mcpManifest.mcpServers.shadcn.args
  .find((argument) => argument.startsWith('shadcn@'))
  ?.slice(7);
if (!registryPin || registryPin !== mcpPin) {
  console.error(
    `shadcn tooling versions differ: registry=${registryPin ?? 'missing'}, MCP=${mcpPin ?? 'missing'}`,
  );
  process.exit(1);
}
// shadcn reads components.json from its working directory, so both entry points must start beside it.
const registryDir = registryCommand.match(
  /cwd: fileURLToPath\(new URL\('\.\.\/\.\.\/([^']+?)\/?'/,
)?.[1];
const mcpArgs = mcpManifest.mcpServers.shadcn.args;
const mcpDir = mcpArgs[mcpArgs.indexOf('--cwd') + 1];
if (!registryDir || !mcpArgs.includes('--cwd') || registryDir !== mcpDir) {
  console.error(
    `shadcn tooling directories differ: registry=${registryDir ?? 'missing'}, MCP=${mcpDir ?? 'missing'}`,
  );
  process.exit(1);
}

const sourceOwnedPrimitives = {
  'apps/frontend/src/components/ui/alert-dialog.tsx':
    'b0606594b1c6c7cbdd3395b4b8da2883a1f152624b2d259b2871ccf0358ca24f',
  'apps/frontend/src/components/ui/alert.tsx':
    '330a5f4c1f07b0d2630d8e752b2b02ad2236c8e62c15695a21da94f5576bfce0',
  'apps/frontend/src/components/ui/avatar.tsx':
    '0139f24b1b0cd085d3f9a8e58363317e54fb1e059c778d9b9073b3d7999a952d',
  'apps/frontend/src/components/ui/badge.tsx':
    '0d7ff98483b43634c32a873ff7d7be60929a922362e9ef852072bc22f6823ae6',
  'apps/frontend/src/components/ui/button.tsx':
    '1baae11e67b9d548f3c538dfdc6ae25c5edc84d42188d98fd708fc35d175cc05',
  'apps/frontend/src/components/ui/dialog.tsx':
    '31cd1372d5c69bef92316cbc1b34d481ef4c15edbf2609152756724410f253e3',
  'apps/frontend/src/components/ui/empty.tsx':
    'e6966082b4736bdd01cbb874a908360d7f6795e3158d446ede0fcb3f10df832d',
  'apps/frontend/src/components/ui/item.tsx':
    'ea2af620f8d88eeecad2fe0976a1d720869f002f11a96d0ccbcdb495a2682064',
  'apps/frontend/src/components/ui/popover.tsx':
    'd1a4b8d715144227a0719d54b00d377f4750542f70551074cf939cce7a52c40f',
  'apps/frontend/src/components/ui/select.tsx':
    '018b4b97f964c8d38c90457ff1c1fd687d6274ef397fc4c3f5f20b966faafd02',
  'apps/frontend/src/components/ui/sheet.tsx':
    'bcb106e68d6e286c01a5c672908c64fdc3f3500c439378b8b97a8d61ff96f7a6',
  'apps/frontend/src/components/ui/sidebar.tsx':
    'a06748292da44fefdf9027b3deb6195610953710b3f6dd20ff68355826bd70fe',
  'apps/frontend/src/components/ui/toggle.tsx':
    'ca13c0cc45a5951155d7d321d782ef91bd5f68c0a623af1bdbd9288212238aa0',
  'apps/frontend/src/components/ui/toggle-group.tsx':
    'c13b73081fc00c367bc22de16799071d9e7616448d8cc05240484384ff9c0210',
  'apps/frontend/src/components/ui/tooltip.tsx':
    '7bc26e506e5379fc21ae6711a83cb46ea90e6b0a204d1b59cbc02ec7aded1aeb',
};

const changed = [];
for (const [path, expected] of Object.entries(sourceOwnedPrimitives)) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url));
  const actual = createHash('sha256').update(source).digest('hex');
  if (actual !== expected) changed.push(path);
}

if (changed.length > 0) {
  console.error(
    [
      'Source-owned UI primitive contract changed:',
      ...changed.map((path) => `- ${path}`),
      'Review the pinned registry dry-run, preserve documented local behaviour, then update this contract deliberately.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log(
  `UI primitive contract verified (${Object.keys(sourceOwnedPrimitives).length} source-owned files; shadcn ${registryPin}).`,
);
