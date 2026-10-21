import { defineConfig } from '@adonisjs/core/bodyparser'
import type { BodyParserConfig } from '@adonisjs/bodyparser/types'

const bodyParserConfig: BodyParserConfig = defineConfig({
  /**
   * Parse request bodies for these HTTP methods.
   * Keep this aligned with methods that receive payloads in your routes.
   */
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],

  /**
   * Config for the "application/x-www-form-urlencoded"
   * content-type parser.
   */
  form: {
    /**
     * Normalize empty string values to null.
     */
    convertEmptyStringsToNull: false,

    /**
     * Content types handled by the form parser.
     */
    types: ['application/x-www-form-urlencoded'],
  },

  /**
   * Config for the JSON parser.
   */
  json: {
    /**
     * Normalize empty string values to null.
     */
    convertEmptyStringsToNull: false,

    /**
     * A company export is posted back whole to the import route, and a large save is one batch.
     * Matches the 6 MB proxy allowance, less headroom; the 1 MB default refuses realistic exports.
     */
    limit: '5mb',
  },

  /**
   * Config for the "multipart/form-data" content-type parser.
   * File uploads are handled by the multipart parser.
   */
  multipart: {
    /**
     * Automatically process uploaded files into the system tmp directory.
     */
    autoProcess: false,

    /**
     * Normalize empty string values to null.
     */
    convertEmptyStringsToNull: false,

    /**
     * Routes where multipart processing is handled manually.
     */
    processManually: [],

    /**
     * Maximum accepted payload size for multipart requests.
     */
    limit: '1mb',

    /**
     * Content types handled by the multipart parser.
     */
    types: [],
  },
})

export default bodyParserConfig
