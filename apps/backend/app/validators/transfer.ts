import vine from '@vinejs/vine';
import { allowedFields, fixedMessage, isSupplied } from '#validators/request_rules';

// The document keeps its own parser and error type; the validator only requires the key.
const previewMessage = 'Invalid beta transfer document.';
export const previewValidator = vine.compile(
  vine
    .object({ companyId: vine.string().minLength(1), document: vine.any().nullable() })
    .use(allowedFields({ fields: ['companyId', 'document'], message: previewMessage }))
);
previewValidator.messagesProvider = fixedMessage(previewMessage);

const applyMessage = 'Invalid beta transfer request.';
export const applyValidator = vine.compile(
  vine
    .object({
      companyId: vine.string().minLength(1),
      document: vine.any().nullable(),
      baseRevision: vine
        .number({ strict: true })
        .withoutDecimals()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER),
      confirmationId: vine.string().optional().requiredWhen(isSupplied),
    })
    .use(
      allowedFields({
        fields: ['companyId', 'document', 'baseRevision', 'confirmationId'],
        message: applyMessage,
      })
    )
);
applyValidator.messagesProvider = fixedMessage(applyMessage);
