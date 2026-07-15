import { describe, expect, it } from 'vitest'
import { buildApp, MAX_SERVER_CONNECTIONS } from './app'
import { openDb } from './db'

describe('process resource limits', () => {
  it('pins a finite accepted-connection ceiling', async () => {
    const db = openDb(':memory:')
    const app = buildApp(db)
    expect(MAX_SERVER_CONNECTIONS).toBe(512)
    expect(app.server.maxConnections).toBe(MAX_SERVER_CONNECTIONS)
    await app.close()
    db.close()
  })
})
