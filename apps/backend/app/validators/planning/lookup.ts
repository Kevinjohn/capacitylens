import vine from '@vinejs/vine';
import { uuid } from '#validators/planning/fields';

export const mutationLookupValidator = vine.compile(vine.object({ mutationId: uuid() }));
