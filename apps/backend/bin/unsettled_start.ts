/**
 * Fails the process when an entry point's start never settles. Two services that wait on each
 * other through the container leave a promise that never settles and raise no error; the event loop
 * then drains and Node would exit 0 having run nothing.
 */
export function failUnsettledStart<T>(start: Promise<T>, entry: string) {
  let settled = false;
  process.once('beforeExit', () => {
    if (settled) return;
    process.exitCode = 1;
    console.error(
      `${entry} stopped before the application started: a container resolution never settled.`
    );
  });
  return start.finally(() => {
    settled = true;
  });
}
