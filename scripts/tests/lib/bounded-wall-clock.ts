// bounded-wall-clock.ts — best-of-N for single-sample upper wall-clock bounds (spec 0264 R10).
//
// A runner stall inflates one sample, not the code under test. `bestOf` passes
// when any attempt meets its bound and stops at the first pass; otherwise it
// throws one error listing every attempt's message.
//
// `measure` runs ONE attempt and returns `{ ok, message, value }`: `ok` is the
// upper-bound verdict, `message` says what that attempt saw, `value` is the
// payload (result, elapsed time) handed back from the passing attempt so the
// caller runs its content assertions once, outside the retry. It may be
// synchronous or asynchronous; the return type follows.
//
// Only the upper bound is retried. A lower-bound check (or any assertion) that
// throws inside `measure` propagates at once, with no further attempt.
// A hang stays bounded by the caller's own abort/timeout inside `measure`.

export interface Attempt<T> {
  ok: boolean;
  message: string;
  value: T;
}

export const DEFAULT_ATTEMPTS = 3;

function failure(messages: string[]): Error {
  return new Error(
    `upper bound missed on all ${messages.length} attempts:\n${messages
      .map((m, i) => `  attempt ${i + 1}: ${m}`)
      .join("\n")}`,
  );
}

export function bestOf<T>(measure: (attempt: number) => Attempt<T>, attempts?: number): T;
export function bestOf<T>(
  measure: (attempt: number) => Promise<Attempt<T>>,
  attempts?: number,
): Promise<T>;
export function bestOf<T>(
  measure: (attempt: number) => Attempt<T> | Promise<Attempt<T>>,
  attempts: number = DEFAULT_ATTEMPTS,
): T | Promise<T> {
  const messages: string[] = [];
  const step = (n: number): T | Promise<T> => {
    const r = measure(n);
    const settle = (a: Attempt<T>): T | Promise<T> => {
      if (a.ok) return a.value;
      messages.push(a.message);
      if (n + 1 >= attempts) throw failure(messages);
      return step(n + 1);
    };
    return r instanceof Promise ? r.then(settle) : settle(r);
  };
  return step(0);
}
