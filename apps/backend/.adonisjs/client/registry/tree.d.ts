/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  api: {
    batch: typeof routes['api.batch']
    lifecycle: typeof routes['api.lifecycle']
    health: typeof routes['api.health']
  }
}
