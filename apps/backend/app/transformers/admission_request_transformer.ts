import { BaseTransformer } from '@adonisjs/core/transformers'
import type { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'

export type AdmissionRequestItem = Awaited<ReturnType<AccountAdmission['list']>>['items'][number]

/** The wire shape of one admission request in the paginated directory. */
export default class AdmissionRequestTransformer extends BaseTransformer<AdmissionRequestItem> {
  toObject() {
    return this.pick(this.resource, [
      'userId',
      'email',
      'requestedAt',
      'invitation',
      'approval',
      'createdAt',
      'updatedAt',
    ])
  }
}
