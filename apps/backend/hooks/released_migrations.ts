import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Bundler } from '@adonisjs/assembler'
import { sourceFiles } from '@adonisjs/lucid/utils'
import { parseManifest } from '../database/released_manifest.js'

const hash = (contents: Buffer) => createHash('sha256').update(contents).digest('hex')

async function discoveredIn(root: string, extension: string) {
  const { files } = await sourceFiles(pathToFileURL(`${root}/`), 'database/migrations', true)
  if (files.some((file) => !file.absPath.endsWith(extension)))
    throw new Error('Migration files differ from the released manifest')
  return files
}

/** Validate released sources and pin the executable build output before packaging. */
export default async function releasedMigrationsHook(bundler: Bundler) {
  const sourceRoot = bundler.cwdPath
  const buildRoot = join(sourceRoot, 'build')
  const sourceManifest = parseManifest(
    JSON.parse(await readFile(join(sourceRoot, 'database/released.json'), 'utf8'))
  )
  const expected = sourceManifest.map(({ name }) => name)
  const sourceMigrations = await discoveredIn(sourceRoot, '.ts')
  const buildFiles = await discoveredIn(buildRoot, '.js')
  const sourceNames = sourceMigrations.map(({ name }) => name)
  const buildNames = buildFiles.map(({ name }) => name)
  if (
    JSON.stringify(sourceNames) !== JSON.stringify(expected) ||
    JSON.stringify(buildNames) !== JSON.stringify(expected)
  )
    throw new Error('Migration files differ from the released manifest')

  const builtMigrations = []
  for (const { name, sha256 } of sourceManifest) {
    const sourceDigest = hash(await readFile(join(sourceRoot, `${name}.ts`)))
    if (sourceDigest !== sha256) throw new Error(`Released migration changed: ${name}`)
    builtMigrations.push({ name, sha256: hash(await readFile(join(buildRoot, `${name}.js`))) })
  }
  await writeFile(
    join(buildRoot, 'database/released.json'),
    `${JSON.stringify({ version: 1, migrations: builtMigrations }, null, 2)}\n`
  )
}
