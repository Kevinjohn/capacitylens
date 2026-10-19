import { defineConfig, stores } from '@adonisjs/limiter'

export default defineConfig({
  default: 'database',
  stores: {
    database: stores.database({ tableName: 'rate_limits' }),
  },
})
