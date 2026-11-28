import router from '@adonisjs/core/services/router'
import { apiPrefix } from '#start/api'
import { throttle } from '#start/limiter'
import { sensitive } from '@kevinjohn/adonisjs-masquerade/http'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router
      .group(() => {
        router.get('/', [controllers.GettingStarted, 'show']).use(sensitive())
        router.put('/', [controllers.GettingStarted, 'update'])
      })
      .prefix('/companies/:companyId/getting-started')
      .use([
        middleware.accountGate({ access: 'admitted' }),
        middleware.auth({ guards: ['web_effective'] }),
        middleware.companyScope(),
      ])
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
