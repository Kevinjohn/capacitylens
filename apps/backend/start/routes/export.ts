import router from '@adonisjs/core/services/router'
import { apiPrefix } from '#start/api'
import { throttle } from '#start/limiter'
import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'

router
  .group(() => {
    router
      .group(() => {
        router.get('/state', [controllers.CompanyState, 'show'])
        router
          .get('/companies/:companyId/export', [controllers.CompanyExport, 'show'])
          .use(middleware.companyScope({ planning: true }))
      })
      .use([
        middleware.accountGate({ access: 'admitted' }),
        middleware.auth({ guards: ['web_effective'] }),
      ])
  })
  .prefix(apiPrefix)
  .as('api')
  .use(throttle)
