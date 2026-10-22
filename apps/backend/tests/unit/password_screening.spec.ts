import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import env from '#start/env'
import {
  assertPasswordAllowed,
  PasswordPolicyError,
  PasswordScreeningUnavailableError,
} from '#services/password_screening'

function enableScreening(cleanup: (callback: () => void) => void) {
  const previous = env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK')
  env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', true)
  cleanup(() => env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', previous))
}

test('password screening rejects product context words without making a network request', async ({
  assert,
}) => {
  await assert.rejects(
    () => assertPasswordAllowed('CapacityLens-is-never-a-secret'),
    PasswordPolicyError
  )
})

test('password screening sends only the SHA-1 prefix and rejects a matching breach suffix', async ({
  assert,
  cleanup,
}) => {
  enableScreening(cleanup)
  const password = 'correct horse battery staple'
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  let requestInit: RequestInit | undefined
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input)
    requestInit = init
    return new Response(`${digest.slice(5)}:1\r\n`)
  }) as typeof fetch

  try {
    await assert.rejects(() => assertPasswordAllowed(password), PasswordPolicyError)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.isTrue(requestUrl.endsWith(digest.slice(0, 5)))
  assert.notInclude(requestUrl, digest)
  assert.deepEqual(requestInit?.headers, {
    'Add-Padding': 'true',
    'User-Agent': 'CapacityLens password checker',
  })
  assert.equal(requestInit?.redirect, 'error')
})

test('password screening fails closed when the breach service is unavailable', async ({
  assert,
  cleanup,
}) => {
  enableScreening(cleanup)
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch
  try {
    await assert.rejects(
      () => assertPasswordAllowed('this is a safe example phrase'),
      PasswordScreeningUnavailableError
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('password screening accepts a clean range and ignores zero-count privacy padding', async ({
  cleanup,
}) => {
  enableScreening(cleanup)
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(`${'A'.repeat(35)}:0\r\n`)) as typeof fetch
  try {
    await assertPasswordAllowed('this is a clean example phrase')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('password screening treats malformed and oversized service responses as unavailable', async ({
  assert,
  cleanup,
}) => {
  enableScreening(cleanup)
  const originalFetch = globalThis.fetch
  for (const response of [
    new Response('not a valid range row'),
    new Response('', { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } }),
  ]) {
    globalThis.fetch = (async () => response) as typeof fetch
    try {
      await assert.rejects(
        () => assertPasswordAllowed('this is a clean example phrase'),
        PasswordScreeningUnavailableError
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  }
})
