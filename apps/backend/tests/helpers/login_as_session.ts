import { configProvider } from '@adonisjs/core'
import type { ApplicationService } from '@adonisjs/core/types'
import type { HttpContext } from '@adonisjs/core/http'
import type { ResolvedSessionConfig, SessionData } from '@adonisjs/session/types'
import { SessionClient } from '@adonisjs/session/client'
import { ApiClient, ApiRequest } from '@japa/api-client'
import type { PluginFn } from '@japa/runner/types'

declare module '@japa/api-client' {
  interface ApiRequest {
    withSession(data: SessionData): this
    loginAsSession?: SessionClient
  }
}

/**
 * Gives `authApiClient` the `withSession` that `loginAs` writes its sign-in through. Unlike the
 * session package's `sessionApiClient`, it touches only requests that call `withSession`: that
 * plugin sends a fresh session cookie on every request and destroys the response's session
 * afterwards, which would end every sign-in a spec makes through the real endpoint.
 */
export function loginAsSession(app: ApplicationService): PluginFn {
  return async () => {
    const config = await configProvider.resolve<ResolvedSessionConfig>(
      app,
      app.config.get('session')
    )
    if (!config) throw new Error('config/session.ts must use defineConfig')
    // A store serves one request, so each operation gets a new one, as `sessionApiClient` does.
    const store = () => config.stores[config.store](null as unknown as HttpContext, config)
    const sessionStore = {
      read: (sessionId: string) => store().read(sessionId),
      write: (sessionId: string, data: SessionData) => store().write(sessionId, data),
      destroy: (sessionId: string) => store().destroy(sessionId),
      touch: (sessionId: string) => store().touch(sessionId),
    }

    ApiRequest.macro('withSession', function (this: ApiRequest, data: SessionData) {
      this.loginAsSession ??= new SessionClient(sessionStore)
      this.loginAsSession.merge(data)
      return this
    })

    ApiClient.onRequest((request) => {
      request.setup(async () => {
        const session = request.loginAsSession
        if (!session) return
        request.withCookie(config.cookieName, session.sessionId)
        await session.commit()
      })
      request.teardown(async () => {
        await request.loginAsSession?.destroy()
      })
    })
  }
}
