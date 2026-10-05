// staleness.ts — the two values the tool evaluates as arithmetic (spec 0248 R20).
//
// `--stale-after` comes from the command line and `since_epoch` comes off disk.
// Both are validated textually and evaluated with BigInt, never with a Number,
// so no width can wrap or lose precision. An unreadable `--stale-after` is a
// caller error and fails closed; an unreadable `since_epoch` is the dead-holder
// case a takeover exists for and reads as infinitely old.

import { ClaimFailure } from "./types.ts";

const STALE_MAX_DIGITS = 9;
const CLOCK_SKEW_TOLERANCE_SECONDS = 300n;
const SINCE_EPOCH_MAX_DIGITS = 18;

/**
 * Validate `--stale-after`: all decimal digits, and at most 9 of them once the
 * leading zeros are stripped (leaving at least one digit). Returns the stripped
 * value, to be read in base 10; throws the shell tool's diagnostic otherwise.
 */
export function validateStaleAfter(raw: string): string {
  if (!/^[0-9]+$/.test(raw)) {
    throw new ClaimFailure(
      `--stale-after must be a non-negative integer number of minutes, got '${raw}'.`,
    );
  }
  let value = raw;
  while (value.length > 1 && value.startsWith("0")) value = value.slice(1);
  if (value.length > STALE_MAX_DIGITS) {
    throw new ClaimFailure(`--stale-after '${raw}' is out of range: at most ${STALE_MAX_DIGITS} digits of
       minutes. The bound is not a policy about how long a claim may be held — a
       claim's age cannot exceed the Unix epoch, so the largest accepted value
       already means 'never stale' by a factor of thirty. It is what keeps
       'minutes * 60' inside the integer arithmetic that evaluates it, because a
       threshold that overflows to a negative number reports every claim as stale
       and grants every takeover — the opposite of what a large value asks for.`);
  }
  return value;
}

/**
 * The age in seconds of a claim, or `undefined` for "infinitely old": a
 * `since_epoch` that is empty, not all digits, has a leading zero, is longer
 * than 18 digits, or lies more than 300 seconds in the future. Up to 300
 * seconds ahead is clock skew between hosts and reads as zero age.
 */
export function claimAgeSeconds(sinceEpoch: string, nowSeconds: number): bigint | undefined {
  if (!/^[0-9]+$/.test(sinceEpoch) || sinceEpoch.startsWith("0")) return undefined;
  if (sinceEpoch.length > SINCE_EPOCH_MAX_DIGITS) return undefined;
  const age = BigInt(nowSeconds) - BigInt(sinceEpoch);
  if (age < -CLOCK_SKEW_TOLERANCE_SECONDS) return undefined;
  return age < 0n ? 0n : age;
}

/** `--stale-after` minutes (already validated) as seconds. */
export function staleSeconds(staleAfter: string): bigint {
  return BigInt(staleAfter) * 60n;
}
