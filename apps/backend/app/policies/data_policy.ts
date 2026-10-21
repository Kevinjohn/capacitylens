import { BasePolicy } from '@adonisjs/bouncer'
import type { BatchCapabilities } from '#services/batch/data_policy'

export interface DataPolicyActor {
  id: string
}

export interface DataPolicyTarget {
  accountId: string
  capabilities: BatchCapabilities
}

/** Authorizes one resolved actor action against one company. */
export default class DataPolicy extends BasePolicy {
  read(actor: DataPolicyActor, target: { accountId: string; hasMembership: boolean }) {
    return actor.id.length > 0 && target.accountId.length > 0 && target.hasMembership
  }

  write(actor: DataPolicyActor, target: DataPolicyTarget) {
    return actor.id.length > 0 && target.accountId.length > 0 && target.capabilities.canWrite
  }

  purge(actor: DataPolicyActor, target: DataPolicyTarget) {
    return (
      actor.id.length > 0 &&
      target.accountId.length > 0 &&
      target.capabilities.canWrite &&
      target.capabilities.canPurge
    )
  }
}
