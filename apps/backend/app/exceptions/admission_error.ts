import { RefusalError } from '#exceptions/refusal_error';

/** A safe product admission refusal with its HTTP contract. */
export class AdmissionError extends RefusalError {
  constructor(
    message: string,
    status: number,
    code: string,
    readonly decision?: Record<string, unknown>
  ) {
    super(message, status, code);
  }

  override body() {
    return { ...super.body(), ...(this.decision === undefined ? {} : { decision: this.decision }) };
  }
}
