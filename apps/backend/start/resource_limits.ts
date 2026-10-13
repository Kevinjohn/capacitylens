import type { Server } from 'node:http'

export const MAX_SERVER_CONNECTIONS = 512
const DROP_LOG_WINDOW_MS = 60_000

/** Applies the finite socket limits to every supported HTTP server entrypoint. */
export function configureNodeServer(
  nodeServer: Server,
  logConnectionDrop: (entry: Record<string, unknown>) => void = () => {}
) {
  nodeServer.maxConnections = MAX_SERVER_CONNECTIONS
  nodeServer.requestTimeout = 30_000
  nodeServer.setTimeout(30_000)
  let lastDropLog = 0
  nodeServer.on('drop', () => {
    const now = Date.now()
    if (now - lastDropLog < DROP_LOG_WINDOW_MS) return
    lastDropLog = now
    logConnectionDrop({
      event: 'connection_limit',
      outcome: 'blocked',
      limit: MAX_SERVER_CONNECTIONS,
    })
  })
  return nodeServer
}
