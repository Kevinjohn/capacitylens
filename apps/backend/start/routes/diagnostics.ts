import router from '@adonisjs/core/services/router'
import { apiPrefix } from '#start/api'
import { throttle } from '#start/limiter'
import { asMemberOnly } from '#start/route_middleware'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router
      .group(() => {
        router.get('/diagnostics', [controllers.Diagnostics, 'show']).use(asMemberOnly())
      })
      .use(middleware.accountGate({ access: 'admitted' }))
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
