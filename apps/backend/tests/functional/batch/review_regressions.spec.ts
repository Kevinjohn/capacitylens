import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import {
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { request as httpRequest } from 'node:http'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { withTransaction } from '#services/with_transaction'
import { applyLifecycle } from '#services/lifecycle'
import { initialCompanyDataContext } from '#services/planning_operations/data_policy'
import { interceptChildLoggers } from '../../helpers/logger.js'

interface RawResponse {
  statusCode: number | undefined
  body: string
}

function postRaw(
  path: string,
  body: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
  cookie?: string
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: Number(process.env.CAPACITYLENS_TEST_HTTP_PORT),
        path,
        method: 'POST',
        headers: {
          'content-type': contentType,
          'content-length': String(body.length),
          'sec-fetch-site': 'same-origin',
          ...(cookie ? { cookie: `adonis-session=${cookie}` } : {}),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })
        )
      }
    )
    request.on('error', reject)
    request.end(body)
  })
}

async function reset(client: ApiClient, seeded = true) {
  const session = await resetAuthenticatedData(client, seeded)
  return { client: authenticatedDataClient(client, session.cookie), cookie: session.cookie }
}

test.group('M2a review regressions', (group) => {
  group.setup(() => freshDatabase())

  test('removes the CSP report endpoint', async ({ client, assert }) => {
    const response = await client
      .post('/api/security/csp-report')
      .json({ report: 'ignored' })
      .send()
    assert.equal(response.status(), 404)
    assert.deepEqual(response.body(), { error: 'Not found.', code: 'NOT_FOUND' })
  })

  test('maps actual oversized form and unsupported encoding parser failures safely', async ({
    client,
    assert,
  }) => {
    const fixture = await reset(client, true)
    client = fixture.client
    const cookie = fixture.cookie
    const oversized = await postRaw(
      '/api/batch',
      Buffer.from(`value=${'x'.repeat(1_100_000)}`),
      'application/x-www-form-urlencoded',
      {},
      cookie
    )
    assert.equal(oversized.statusCode, 413)
    assert.deepEqual(JSON.parse(oversized.body), {
      error: 'Request body is too large.',
      code: 'PAYLOAD_TOO_LARGE',
    })

    const unsupported = await postRaw(
      '/api/batch',
      Buffer.from('value=x'),
      'application/x-www-form-urlencoded',
      { 'content-encoding': 'compress' },
      cookie
    )
    assert.equal(unsupported.statusCode, 415)
    assert.deepEqual(JSON.parse(unsupported.body), {
      error: 'Unsupported media type.',
      code: 'UNSUPPORTED_MEDIA_TYPE',
    })
  })

  test('logs lifecycle writes only after commit and keeps logger failure best-effort', async ({
    client,
    assert,
    cleanup,
  }) => {
    const fixture = await reset(client, true)
    client = fixture.client
    const project = seed().projects[0]!
    const entries: Array<Record<string, unknown>> = []
    let restoreLogger = interceptChildLoggers((child) => {
      child.info = ((entry: unknown) => {
        if (typeof entry === 'object' && entry !== null)
          entries.push(entry as Record<string, unknown>)
      }) as unknown as typeof child.info
    })
    cleanup(() => restoreLogger())

    const archived = await client
      .post(`/api/projects/${project.id}/archive`)
      .header('sec-fetch-site', 'same-origin')
      .json({ accountId: project.accountId })
      .send()
    archived.assertStatus(200)
    assert.deepInclude(entries[0], {
      event: 'capacitylens.lifecycle.committed',
      action: 'archive',
      entity: 'projects',
      entityId: project.id,
      accountId: project.accountId,
    })

    restoreLogger()
    restoreLogger = interceptChildLoggers((child) => {
      child.info = (() => {
        throw new Error('log unavailable')
      }) as typeof child.info
    })
    const unarchived = await client
      .post(`/api/projects/${project.id}/unarchive`)
      .header('sec-fetch-site', 'same-origin')
      .json({ accountId: project.accountId })
      .send()
    unarchived.assertStatus(200)
    assert.equal(unarchived.header('x-capacitylens-audit-warning'), 'true')
    const storedProject = await db.from('projects').where('id', project.id).first()
    assert.isNull(storedProject.archived_at)

    let rollbackLogs = 0
    const context = initialCompanyDataContext('rollback-actor', () => {
      rollbackLogs++
    })
    await assert.rejects(() =>
      withTransaction(async (trx) => {
        await applyLifecycle(trx, 'projects', project.id, project.accountId, 'archive', context)
        throw new Error('force rollback')
      })
    )
    assert.equal(rollbackLogs, 0)

    restoreLogger()
    restoreLogger = interceptChildLoggers((child) => {
      child.info = ((entry: unknown) => {
        if (typeof entry === 'object' && entry !== null)
          entries.push(entry as Record<string, unknown>)
      }) as unknown as typeof child.info
    })
    const purgeProject = seed().projects.find((row) => row.id !== project.id)!
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
    await db
      .from('projects')
      .where('id', purgeProject.id)
      .update({ archived_at: null, deleted_at: old, updated_at: old })
    const purged = await client
      .post(`/api/projects/${purgeProject.id}/purge`)
      .header('sec-fetch-site', 'same-origin')
      .json({ accountId: purgeProject.accountId })
      .send()
    purged.assertStatus(204)
    assert.deepInclude(entries.at(-1), {
      event: 'capacitylens.lifecycle.committed',
      action: 'purge',
      entity: 'projects',
      entityId: purgeProject.id,
    })
  })
})
