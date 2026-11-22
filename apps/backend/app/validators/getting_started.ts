import vine from '@vinejs/vine';

export const updateGettingStartedValidator = vine.create(
  vine.object({ dismissed: vine.literal(true) })
);
