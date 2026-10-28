import vine from '@vinejs/vine';

/** Unknown query fields remain ignored; cursor is opaque and may be empty. */
export const admissionQueryValidator = vine.compile(
  vine.object({
    status: vine.enum(['pending', 'approved', 'rejected', 'revoked']).optional(),
    cursor: vine
      .string()
      .use(
        vine.createRule((value, _options, field) => {
          if (typeof value === 'string' && value.length > 512)
            field.report('Invalid cursor.', 'cursorLength', field);
        })()
      )
      .optional(),
  })
);
