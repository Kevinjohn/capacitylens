import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const mcpManifest = JSON.parse(await readFile(new URL('../../.mcp.json', import.meta.url), 'utf8'))
const registryCommand = await readFile(new URL('./ui-registry.mjs', import.meta.url), 'utf8')
const registryPin = registryCommand.match(/shadcn@([^\s"']+)/)?.[1]
const mcpPin = mcpManifest.mcpServers.shadcn.args
  .find((argument) => argument.startsWith('shadcn@'))
  ?.slice(7)
if (!registryPin || registryPin !== mcpPin) {
  console.error(
    `shadcn tooling versions differ: registry=${registryPin ?? 'missing'}, MCP=${mcpPin ?? 'missing'}`
  )
  process.exit(1)
}
// shadcn reads components.json from its working directory, so both entry points must start beside it.
const registryDir = registryCommand.match(
  /cwd: fileURLToPath\(new URL\('\.\.\/\.\.\/([^']+?)\/?'/
)?.[1]
const mcpArgs = mcpManifest.mcpServers.shadcn.args
const mcpDir = mcpArgs[mcpArgs.indexOf('--cwd') + 1]
if (!registryDir || !mcpArgs.includes('--cwd') || registryDir !== mcpDir) {
  console.error(
    `shadcn tooling directories differ: registry=${registryDir ?? 'missing'}, MCP=${mcpDir ?? 'missing'}`
  )
  process.exit(1)
}

const sourceOwnedPrimitives = {
  'apps/frontend/src/components/ui/alert-dialog.tsx':
    'df6ef9f59f9bba02e5e27ba29e7e6d849a99d452e56864d2963e991f4d1d9557',
  'apps/frontend/src/components/ui/alert.tsx':
    '4c7c85d4a4ebd42a60a4dc9e593e239148e51b270f91735e1bcb2a121dfc9112',
  'apps/frontend/src/components/ui/avatar.tsx':
    '7ec0e9769bff93291e5ba183083da4bcd8a1fdb6e52aff741662968f1e97b3e6',
  'apps/frontend/src/components/ui/badge.tsx':
    'ede9ea884977d12498318e08d137a567e20998c2d7bde3f843825a316e1bf117',
  'apps/frontend/src/components/ui/button.tsx':
    '0d41cca452c61d19d617f26117f5425dc9b8e477be31d996a59a61242e3e7c04',
  'apps/frontend/src/components/ui/dialog.tsx':
    '4c155ed86c359ccffa383134d5fea0acc0e9750f321b96daa9ea55a3da2608a0',
  'apps/frontend/src/components/ui/empty.tsx':
    '47e92681544bd611fce2b8667899e09ab2c32d07ffc4222d709ac658a4638dc9',
  'apps/frontend/src/components/ui/item.tsx':
    'a2f573abe7d8537de1d8f01fa54c86d09915badefd27ccfce41f3e7148aefe1d',
  'apps/frontend/src/components/ui/popover.tsx':
    '5c742c67d72b8a26a275144592b5bbf0d6fc4433e30b33c19ca71e4157987424',
  'apps/frontend/src/components/ui/select.tsx':
    '618ae776ffa34349963e4b2c76220972573e09af845b1200716b372ff0a75ea0',
  'apps/frontend/src/components/ui/sheet.tsx':
    '4bc09a5108a12f30c30eed288f05b8a790662370f8c8d102adc760dcae0a531d',
  'apps/frontend/src/components/ui/sidebar.tsx':
    'fef45f8145c399f9b05e20799f9328594e34871181488d5bb62175a92241d0eb',
  'apps/frontend/src/components/ui/toggle.tsx':
    '597d708bda32c5cad5ac15a3e718a5c510c696f09e3af45366de73a96b27ae00',
  'apps/frontend/src/components/ui/toggle-group.tsx':
    'dead1904882ce8287b0087f250d1e3a12cb5d957e2b37ddf0a430ad26306bff7',
  'apps/frontend/src/components/ui/tooltip.tsx':
    'e625bb8f5ad8c024426d0cbf51c2ee1480db47bc999374899957670291e05795',
}

const changed = []
for (const [path, expected] of Object.entries(sourceOwnedPrimitives)) {
  const source = await readFile(new URL(`../../${path}`, import.meta.url))
  const actual = createHash('sha256').update(source).digest('hex')
  if (actual !== expected) changed.push(path)
}

if (changed.length > 0) {
  console.error(
    [
      'Source-owned UI primitive contract changed:',
      ...changed.map((path) => `- ${path}`),
      'Review the pinned registry dry-run, preserve documented local behaviour, then update this contract deliberately.',
    ].join('\n')
  )
  process.exit(1)
}

console.log(
  `UI primitive contract verified (${Object.keys(sourceOwnedPrimitives).length} source-owned files; shadcn ${registryPin}).`
)
