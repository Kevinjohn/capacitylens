import vine from '@vinejs/vine';

export const updateValidator = vine.create(vine.object({ dismissed: vine.literal(true) }));
