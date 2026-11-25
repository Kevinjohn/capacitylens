import vine from '@vinejs/vine';
import { companyIdParam } from '#validators/request_rules';

/** Adding example data names its company in the route; the body is not read. */
export const createExampleDataValidator = vine.create(
  vine.object({ params: vine.object({ companyId: companyIdParam() }) })
);
