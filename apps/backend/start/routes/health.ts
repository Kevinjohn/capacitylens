import router from '@adonisjs/core/services/router'
import { controllers } from '#generated/controllers'

// The probes are outside the versioned API, so the API throttle does not count them.
router.get('/health/live', [controllers.HealthChecks, 'live'])
router.get('/health/ready', [controllers.HealthChecks, 'ready'])
