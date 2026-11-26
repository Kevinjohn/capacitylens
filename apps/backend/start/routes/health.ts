import router from '@adonisjs/core/services/router';
import { controllers } from '#generated/controllers';

// The API health route is in its own group, so the API throttle does not count it.
router
  .group(() => {
    router.get('/health', [controllers.Liveness]);
  })
  .prefix('/api')
  .as('api');

router.get('/health/live', [controllers.Liveness]);
router.get('/health/ready', [controllers.HealthChecks]);
