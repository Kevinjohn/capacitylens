import router from '@adonisjs/core/services/router'
import { apiPrefix } from '#start/api'
import { throttle } from '#start/limiter'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

// The import preview and apply endpoints.
router
  .group(() => {
    router
      .group(() => {
        router.post('/preview', [controllers.ImportPreviews, 'store'])
        router.post('/apply', [controllers.Imports, 'store'])
      })
      .prefix('/import')
      .use([
        middleware.accountGate({ access: 'admitted' }),
        middleware.auth({ guards: ['web_effective'] }),
      ])
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
