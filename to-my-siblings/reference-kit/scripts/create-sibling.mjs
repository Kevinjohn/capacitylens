#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// This is internal tooling stored under to-my-siblings; CapacityLens does not import it or run it
// from its product gate.
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function usage(message) {
  if (message) console.error('Error: ' + message + '\n')
  console.error(
    [
      'Usage:',
      '  node to-my-siblings/reference-kit/scripts/create-sibling.mjs --name "Product Name" --slug product-name <empty-target-directory>',
      '',
      'Options:',
      '  --name         Public product name.',
      '  --slug         Lowercase kebab-case repository, package and storage name.',
      '  --env-prefix   Optional server environment prefix; defaults to slug uppercased with _.',
      '',
      'The target must be outside this checkout and either absent or empty.',
    ].join('\n'),
  )
  process.exit(2)
}

function parseArguments(argv) {
  const options = {}
  const positional = []
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--name' || argument === '--slug' || argument === '--env-prefix') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) usage('missing value for ' + argument)
      options[argument.slice(2)] = value
      index++
    } else if (argument.startsWith('--')) {
      usage('unknown option ' + argument)
    } else {
      positional.push(argument)
    }
  }
  if (positional.length !== 1) usage('provide exactly one target directory')
  return { ...options, target: positional[0] }
}

const arguments_ = parseArguments(process.argv.slice(2))
const productName = arguments_.name?.trim()
const slug = arguments_.slug?.trim()
const envPrefix = (arguments_['env-prefix'] ?? slug?.replaceAll('-', '_').toUpperCase())?.trim()

if (!productName || productName.length < 2) usage('--name must contain at least two characters')
if (!/^[a-z][a-z0-9-]*$/.test(slug ?? '')) usage('--slug must be lowercase kebab-case')
if (!/^[A-Z][A-Z0-9_]*$/.test(envPrefix ?? '')) usage('--env-prefix must be uppercase')

const targetRoot = resolve(arguments_.target)
if (
  targetRoot === sourceRoot ||
  targetRoot.startsWith(sourceRoot + sep) ||
  sourceRoot.startsWith(targetRoot + sep)
) {
  usage('target must be outside the CapacityLens checkout')
}

if (existsSync(targetRoot)) {
  if (!statSync(targetRoot).isDirectory()) usage('target exists and is not a directory')
  if (readdirSync(targetRoot).length > 0) usage('target directory must be empty')
} else {
  mkdirSync(targetRoot, { recursive: true })
}

const excludedDirectories = new Set([
  '.git',
  '.stryker-tmp',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'reports',
  'test-results',
])
const excludedRelativeDirectories = new Set([
  '.claude/worktrees',
  'server/coverage',
  'shared/coverage',
  'src/paraglide',
])
const excludedExactFiles = new Set(['.DS_Store', '.env'])

let includedFiles
try {
  includedFiles = new Set(
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).split('\0').filter(Boolean),
  )
} catch (error) {
  console.error(
    'Error: the sibling generator must run from a Git checkout so ignored private files cannot be copied.',
  )
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const includedDirectories = new Set()
for (const file of includedFiles) {
  let separatorIndex = file.lastIndexOf('/')
  while (separatorIndex > 0) {
    includedDirectories.add(file.slice(0, separatorIndex))
    separatorIndex = file.lastIndexOf('/', separatorIndex - 1)
  }
}

function isSensitiveOrGeneratedFile(relativePath) {
  const name = basename(relativePath)
  if (excludedExactFiles.has(name)) return true
  if (name.startsWith('.env.') && name !== '.env.example') return true
  if (/\.(?:pem|key|p12|pfx)$/i.test(name)) return true
  if (/\.(?:db|db-wal|db-shm|sqlite|sqlite3|log)$/i.test(name)) return true
  if (/audit.*\.jsonl$/i.test(name)) return true
  return false
}

const replacements = [
  ['CapacityLens', productName],
  ['CAPACITYLENS', envPrefix],
  ['capacitylens', slug],
]

function rebrand(value) {
  return replacements.reduce(
    (current, [before, after]) => current.replaceAll(before, after),
    value,
  )
}

let copiedFiles = 0
let rebrandedFiles = 0

function copyTree(currentSource, sourceRelative = '') {
  for (const entry of readdirSync(currentSource, { withFileTypes: true })) {
    const relativePath = sourceRelative ? join(sourceRelative, entry.name) : entry.name
    const normalizedRelative = relativePath.split(sep).join('/')
    if (entry.isDirectory()) {
      if (
        excludedDirectories.has(entry.name) ||
        entry.name.startsWith('.tmp-') ||
        excludedRelativeDirectories.has(normalizedRelative) ||
        !includedDirectories.has(normalizedRelative)
      ) {
        continue
      }
      copyTree(join(currentSource, entry.name), relativePath)
      continue
    }

    const source = join(currentSource, entry.name)
    if (
      !entry.isFile() ||
      lstatSync(source).isSymbolicLink() ||
      !includedFiles.has(normalizedRelative)
    ) continue
    if (isSensitiveOrGeneratedFile(normalizedRelative)) continue

    const targetRelative = rebrand(relativePath)
    const target = join(targetRoot, targetRelative)
    mkdirSync(dirname(target), { recursive: true })

    const bytes = readFileSync(source)
    if (bytes.includes(0)) {
      copyFileSync(source, target)
    } else {
      const original = bytes.toString('utf8')
      const branded = rebrand(original)
      writeFileSync(target, branded)
      if (branded !== original) rebrandedFiles++
    }
    chmodSync(target, statSync(source).mode)
    copiedFiles++
  }
}

copyTree(sourceRoot)

for (const path of ['package.json', 'shared/package.json', 'server/package.json']) {
  const absolute = join(targetRoot, path)
  if (!existsSync(absolute)) continue
  const packageJson = JSON.parse(readFileSync(absolute, 'utf8'))
  packageJson.version = '0.1.0'
  writeFileSync(absolute, JSON.stringify(packageJson, null, 2) + '\n')
}

const manifest = JSON.parse(readFileSync(
  join(targetRoot, 'to-my-siblings/reference-kit/examples/family.example.json'),
  'utf8',
))
const sourcePackage = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'))
writeFileSync(
  join(targetRoot, 'to-my-siblings/smallsass.origin.json'),
  JSON.stringify(
    {
      family: 'SmallSass',
      contractVersion: manifest.contractVersion,
      kitVersion: manifest.kitVersion,
      generatedAt: new Date().toISOString(),
      generatedFrom: {
        product: 'CapacityLens',
        productVersion: sourcePackage.version,
      },
      product: {
        name: productName,
        slug,
        envPrefix,
      },
    },
    null,
    2,
  ) + '\n',
)

// copyTree rebrands lower-case product names in paths. Keep this explicit fallback for an older
// generator output where the reference-map filename itself was not rewritten.
const oldReferenceMap = join(targetRoot, 'to-my-siblings/16-capacitylens-reference-map.md')
const newReferenceMap = join(targetRoot, `to-my-siblings/16-${slug}-reference-map.md`)
if (existsSync(oldReferenceMap) && oldReferenceMap !== newReferenceMap) {
  if (existsSync(newReferenceMap)) throw new Error('reference-map target collision')
  renameSync(oldReferenceMap, newReferenceMap)
}

console.log(`Created ${productName} at ${targetRoot}`)
console.log(`Copied ${copiedFiles} source files; rebranded ${rebrandedFiles} text files.`)
console.log('Next: read to-my-siblings/reference-kit/starter/START-HERE.md, adapt the domain, install dependencies, and run the product gates.')
