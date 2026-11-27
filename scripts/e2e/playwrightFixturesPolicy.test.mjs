import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const e2eRoot = fileURLToPath(new URL('../../e2e/', import.meta.url))

test('secondary browser contexts go through the page-error-observing fixture', () => {
  const directContextCreators = readdirSync(e2eRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .filter((path) => readFileSync(path, 'utf8').includes('browser.newContext('))

  assert.deepEqual(directContextCreators, [])
})
