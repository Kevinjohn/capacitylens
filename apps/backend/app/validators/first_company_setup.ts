import vine from '@vinejs/vine';
import { MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings';
import { allowedFields, fixedMessage, isSupplied } from '#validators/request_rules';

export const firstCompanySetupMessage = `Enter a company name of up to ${MAX_NAME_LENGTH} characters without unsupported characters, a Sunday or Monday week start, and a supported time zone.`;

/**
 * The calendar fields are additive: a name-only body keeps the defaults, but a supplied `null`
 * is refused. The name and time-zone rules stay in the service.
 */
export const storeValidator = vine.create(
  vine
    .object({
      name: vine.string(),
      weekStartsOn: vine
        .enum([0, 1] as const)
        .optional()
        .requiredWhen(isSupplied),
      timeZone: vine.string().optional().requiredWhen(isSupplied),
    })
    .use(
      allowedFields({
        fields: ['name', 'weekStartsOn', 'timeZone'],
        message: firstCompanySetupMessage,
      })
    )
);
storeValidator.messagesProvider = fixedMessage(firstCompanySetupMessage);
