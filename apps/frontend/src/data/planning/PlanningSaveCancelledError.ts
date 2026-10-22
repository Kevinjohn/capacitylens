/** Signals an explicit cancelled save to editors whose public update action returns no value. */
export class PlanningSaveCancelledError extends Error {
  constructor() {
    super("The planning save was cancelled.");
    this.name = "PlanningSaveCancelledError";
  }
}
