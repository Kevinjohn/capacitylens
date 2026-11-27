import ProductException from '#exceptions/product_exception'

/** Server diagnostics could not read database state. */
export default class DiagnosticsUnavailableException extends ProductException {
  static status = 503
  static message = 'Diagnostics could not read database state.'

  override body(): Record<string, unknown> {
    return {
      server: {
        connectivity: 'ok',
        database: { status: 'unavailable' },
        schema: { migration: null },
        backup: { newestBackupAt: null },
      },
    }
  }
}
