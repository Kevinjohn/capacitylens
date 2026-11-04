import vine from '@vinejs/vine';
import type { Infer } from '@vinejs/vine/types';
import { revision, uuid } from '#validators/planning/fields';

export const mutationLookupValidator = vine.compile(vine.object({ mutationId: uuid() }));
export const mutationLookupReplyValidator = vine.compile(
  vine.union([
    vine.union.if(
      // The request body is untrusted, whatever the declared parameter type says.
      (value: unknown) =>
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as { status?: unknown }).status === 'committed',
      vine.object({
        status: vine.literal('committed'),
        mutationId: uuid(),
        revision: revision(),
        restorationGroupId: uuid().optional(),
      })
    ),
    vine.union.else(vine.object({ status: vine.literal('unknown'), mutationId: uuid() })),
  ])
);
export type MutationLookupInput = Infer<typeof mutationLookupValidator>;
