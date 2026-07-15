#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const target = mkdtempSync(join(tmpdir(), 'smallsass-sibling-smoke-'))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  execFileSync(
    process.execPath,
    [
      join(root, 'to-my-siblings/reference-kit/scripts/create-sibling.mjs'),
      '--name',
      'Family Smoke',
      '--slug',
      'family-smoke',
      target,
    ],
    { cwd: root, stdio: 'pipe' },
  )
  const manifest = JSON.parse(readFileSync(
    join(target, 'to-my-siblings/reference-kit/examples/family.example.json'),
    'utf8',
  ))
  const origin = JSON.parse(readFileSync(join(target, 'to-my-siblings/smallsass.origin.json'), 'utf8'))
  const sharedPackage = readFileSync(join(target, 'shared/package.json'), 'utf8')

  assert(manifest.product.name === 'Family Smoke', 'generated display name did not change')
  assert(manifest.product.slug === 'family-smoke', 'generated slug did not change')
  assert(manifest.product.envPrefix === 'FAMILY_SMOKE', 'generated env prefix did not change')
  assert(origin.generatedFrom.product.length > 0, 'generated provenance is missing')
  assert(sharedPackage.includes('@family-smoke/shared'), 'generated package scope did not change')
  assert(
    existsSync(join(target, 'to-my-siblings/reference-kit/starter/START-HERE.md')),
    'generated internal start guide is missing',
  )
  assert(existsSync(join(target, '.env.example')), 'generator dropped the environment template')
  assert(!existsSync(join(target, '.git')), 'generator copied Git history')
  assert(!existsSync(join(target, 'node_modules')), 'generator copied dependencies')
  assert(!existsSync(join(target, '.env')), 'generator copied a local environment file')
  assert(
    !existsSync(join(target, 'FORGE-DEPLOY-RUNBOOK.md')),
    'generator copied the ignored private Forge runbook',
  )

  console.log('SmallSass sibling generator smoke test passed.')
} finally {
  rmSync(target, { force: true, recursive: true })
}
