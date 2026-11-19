import vine from '@vinejs/vine';

export const updateValidator = vine.compile(vine.object({ dismissed: vine.literal(true) }));
