import { BaseTransformer } from '@adonisjs/core/transformers';
import type { AccessGrant } from '@capacitylens/shared/domain/access';

/** A company the signed-in person may enter, with their role and what it grants. */
export type CompanySummary = { id: string; name: string; role: string } & AccessGrant;

/** The wire shape of one entry in the company directory. */
export default class CompanySummaryTransformer extends BaseTransformer<CompanySummary> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'name',
      'role',
      'permissions',
      'canSeePrivateNames',
      'canSeeTimeOffNote',
    ]);
  }
}
