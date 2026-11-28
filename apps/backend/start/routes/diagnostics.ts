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
        router.get('/diagnostics', [controllers.Diagnostics, 'show'])
      })
      .use([
        middleware.accountGate({ access: 'admitted' }),
        middleware.auth({ guards: ['web_effective'] }),
        sensitive(),
      ])
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
