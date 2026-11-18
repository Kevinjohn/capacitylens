import { defineConfig } from '@adonisjs/core/bodyparser';
import type { BodyParserConfig } from '@adonisjs/bodyparser/types';

const bodyParserConfig: BodyParserConfig = defineConfig({
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],

  form: {
    convertEmptyStringsToNull: false,
    types: ['application/x-www-form-urlencoded'],
  },

  json: {
    convertEmptyStringsToNull: false,

    /**
     * A company export is posted back whole to the import route, and a large save is one batch.
     * Matches the 6 MB proxy allowance, less headroom; the 1 MB default refuses realistic exports.
     */
    limit: '5mb',
  },

  multipart: {
    autoProcess: false,
    convertEmptyStringsToNull: false,
    processManually: [],
    limit: '1mb',
    types: [],
  },
});

export default bodyParserConfig;
