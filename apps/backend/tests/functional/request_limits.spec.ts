import { test } from '@japa/runner'
import { freshDatabase } from '../helpers/fresh_database.js'
import logger from '@adonisjs/core/services/logger'
import server from '@adonisjs/core/services/server'
import { MAX_SERVER_CONNECTIONS } from '#start/resource_limits'

test.group('M2a request infrastructure', (group) => {
  group.setup(() => freshDatabase())

  test('applies the configured Node connection and request timeouts and rate-limits drop logs', async ({
    assert,
  }) => {
    const nodeServer = server.getNodeServer()
    assert.exists(nodeServer)
    assert.equal(nodeServer!.maxConnections, MAX_SERVER_CONNECTIONS)
    assert.equal(nodeServer!.requestTimeout, 30_000)
    assert.equal(nodeServer!.timeout, 30_000)

    const originalWarn = logger.warn
    const warnings: unknown[][] = []
    logger.warn = ((...args: unknown[]) => {
      warnings.push(args)
    }) as typeof logger.warn
    try {
      nodeServer!.emit('drop')
      nodeServer!.emit('drop')
      assert.lengthOf(warnings, 1)
      assert.deepEqual(warnings[0]?.[0], {
        event: 'connection_limit',
        outcome: 'blocked',
        limit: MAX_SERVER_CONNECTIONS,
      })
    } finally {
      logger.warn = originalWarn
    }
  })
})
