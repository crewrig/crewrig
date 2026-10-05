// signals.ts — interrupt and termination while `run` wraps a command (spec 0248
// R21).
//
// The shell tool ran `trap run_release_on_exit EXIT INT TERM`: a trapped signal
// is deferred until the foreground command ends, so the claim is never released
// while the wrapped command is still running, and a signal sent only to the
// parent leaves the child untouched. A Node.js process with no listener for a
// signal dies on it at once, which would strand the claim and leave the child
// running; with a listener the process lives, and the listener here does
// nothing and forwards nothing. The release then runs after the child ends.
//
// Exactly SIGINT and SIGTERM, as the shell tool's `INT TERM` and R21's
// "interrupt or termination request": SIGHUP is not handled (plan v1-F7).

const HELD: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

/** The slice of `process` this module needs; injectable so a test can observe it. */
export interface SignalHost {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

/**
 * Install the no-op listeners and return the function that removes them. Call it
 * once the claim is acquired and call the returned function after the release,
 * so no signal can end the process between the two.
 */
export function holdSignals(host: SignalHost = process): () => void {
  const ignore = (): void => {};
  for (const signal of HELD) host.on(signal, ignore);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    for (const signal of HELD) host.off(signal, ignore);
  };
}
