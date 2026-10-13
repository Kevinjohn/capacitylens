/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  api: {
    batch: typeof routes['api.batch']
    import: typeof routes['api.import']
    state: typeof routes['api.state']
    orgs: {
      store: typeof routes['api.orgs.store']
    }
    accounts: {
      store: typeof routes['api.accounts.store']
      update: typeof routes['api.accounts.update']
      destroy: typeof routes['api.accounts.destroy']
    }
    exampleData: typeof routes['api.example-data']
    gettingStarted: {
      show: typeof routes['api.getting-started.show']
      update: typeof routes['api.getting-started.update']
    }
    lifecycle: typeof routes['api.lifecycle']
    health: typeof routes['api.health']
  }
}
