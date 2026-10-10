// mempalace-version.ts — the MemPalace supported-range check of the four setups
// (spec 0256 requirement 44 deviation (r), delta-01).
//
// The shell evaluated `min <= version < max` with `packaging.version.Version` in
// the MemPalace environment (`mempalace_version_in_range`, scripts/lib/common.sh);
// the setup now evaluates it itself, so the check no longer needs `packaging`.
// This module reproduces the parse grammar and the ordering of `Version`
// (PEP 440, as `packaging` 24 implements it): an optional leading `v`, an epoch
// `N!`, the release segment (compared numerically, trailing zeros ignored), a
// pre-release (`a`, `b`, `rc` with the aliases alpha, beta, c, pre, preview), a
// post-release (`.post`, `-N`, `rev`, `r`), a development release (`.dev`) and a
// local label (`+local`); case-insensitive, surrounding whitespace ignored.
// Ordering: dev < pre < final < post, and a local label sorts above the same
// public version. An empty or unparsable version is out of range.
//
// Pure functions: no file system, no process, no shell. Standard library only.

/** A release or segment number; BigInt because Python integers are unbounded. */
type Num = bigint;

type PreLetter = "a" | "b" | "rc";

interface Parsed {
  readonly epoch: Num;
  /** The release segment with trailing zeros removed. */
  readonly release: readonly Num[];
  readonly pre: readonly [PreLetter, Num] | undefined;
  readonly post: Num | undefined;
  readonly dev: Num | undefined;
  /** Local label segments: a number, or a lowercase alphanumeric string. */
  readonly local: readonly (Num | string)[] | undefined;
}

// `packaging.version.VERSION_PATTERN`, compiled `re.VERBOSE | re.IGNORECASE`
// and anchored with optional surrounding whitespace as `Version.__init__` does.
const VERSION_RE = new RegExp(
  "^\\s*v?" +
    "(?:(?:([0-9]+)!)?" + // 1 epoch
    "([0-9]+(?:\\.[0-9]+)*)" + // 2 release
    "([-_.]?(alpha|a|beta|b|preview|pre|c|rc)[-_.]?([0-9]+)?)?" + // 3 pre, 4 letter, 5 number
    "((?:-([0-9]+))|(?:[-_.]?(post|rev|r)[-_.]?([0-9]+)?))?" + // 6 post, 7 -N, 8 letter, 9 number
    "([-_.]?(dev)[-_.]?([0-9]+)?)?" + // 10 dev, 11 letter, 12 number
    ")" +
    "(?:\\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?" + // 13 local
    "\\s*$",
  "i",
);

function group(match: RegExpExecArray, index: number): string | undefined {
  const value: unknown = match[index];
  return typeof value === "string" ? value : undefined;
}

function preLetter(raw: string): PreLetter {
  const letter = raw.toLowerCase();
  if (letter === "alpha" || letter === "a") return "a";
  if (letter === "beta" || letter === "b") return "b";
  return "rc"; // c, pre, preview, rc
}

function stripTrailingZeros(release: readonly Num[]): readonly Num[] {
  let end = release.length;
  while (end > 0 && release[end - 1] === 0n) end -= 1;
  return release.slice(0, end);
}

function parseVersion(text: unknown): Parsed | undefined {
  if (typeof text !== "string") return undefined;
  const match = VERSION_RE.exec(text);
  if (match === null) return undefined;
  const releaseText = group(match, 2);
  if (releaseText === undefined) return undefined;
  const preRaw = group(match, 4);
  const postText = group(match, 6);
  const devText = group(match, 10);
  const localText = group(match, 13);
  const postNumber = group(match, 7) ?? group(match, 9);
  return {
    epoch: BigInt(group(match, 1) ?? "0"),
    release: stripTrailingZeros(releaseText.split(".").map((part) => BigInt(part))),
    pre: preRaw === undefined ? undefined : [preLetter(preRaw), BigInt(group(match, 5) ?? "0")],
    post: postText === undefined ? undefined : BigInt(postNumber ?? "0"),
    dev: devText === undefined ? undefined : BigInt(group(match, 12) ?? "0"),
    local:
      localText === undefined
        ? undefined
        : localText
            .toLowerCase()
            .split(/[-_.]/)
            .map((part) => (/^[0-9]+$/.test(part) ? BigInt(part) : part)),
  };
}

function cmpNum(a: Num, b: Num): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpRelease(a: readonly Num[], b: readonly Num[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    // A missing segment is a zero: 3.6 equals 3.6.0 (trailing zeros are stripped).
    const c = cmpNum(a[i] ?? 0n, b[i] ?? 0n);
    if (c !== 0) return c;
  }
  return 0;
}

const PRE_RANK: Readonly<Record<PreLetter, number>> = { a: 0, b: 1, rc: 2 };

/**
 * The pre-release slot of `packaging`'s sort key: a development release with no
 * pre-release and no post-release sorts below every pre-release (-1), a version
 * with no pre-release otherwise sorts above every pre-release (+1), and a
 * pre-release is its (letter, number) pair (0).
 */
function preSlot(p: Parsed): { readonly tier: -1 | 0 | 1; readonly value: readonly [number, Num] } {
  if (p.pre !== undefined) return { tier: 0, value: [PRE_RANK[p.pre[0]], p.pre[1]] };
  if (p.post === undefined && p.dev !== undefined) return { tier: -1, value: [0, 0n] };
  return { tier: 1, value: [0, 0n] };
}

function cmpOptional(a: Num | undefined, b: Num | undefined, absent: -1 | 1): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return absent;
  if (b === undefined) return -absent;
  return cmpNum(a, b);
}

/** A numeric local segment sorts above an alphanumeric one; strings compare as text. */
function cmpLocalSegment(a: Num | string, b: Num | string): number {
  if (typeof a === "bigint" && typeof b === "bigint") return cmpNum(a, b);
  if (typeof a === "bigint") return 1;
  if (typeof b === "bigint") return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpLocal(
  a: readonly (Num | string)[] | undefined,
  b: readonly (Num | string)[] | undefined,
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) continue;
    const c = cmpLocalSegment(x, y);
    if (c !== 0) return c;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

function compare(a: Parsed, b: Parsed): number {
  let c = cmpNum(a.epoch, b.epoch);
  if (c !== 0) return c;
  c = cmpRelease(a.release, b.release);
  if (c !== 0) return c;
  const pa = preSlot(a);
  const pb = preSlot(b);
  if (pa.tier !== pb.tier) return pa.tier < pb.tier ? -1 : 1;
  c = cmpNum(BigInt(pa.value[0]), BigInt(pb.value[0]));
  if (c !== 0) return c;
  c = cmpNum(pa.value[1], pb.value[1]);
  if (c !== 0) return c;
  c = cmpOptional(a.post, b.post, -1); // no post-release sorts below any post-release
  if (c !== 0) return c;
  c = cmpOptional(a.dev, b.dev, 1); // no dev release sorts above any dev release
  if (c !== 0) return c;
  return cmpLocal(a.local, b.local);
}

/**
 * Whether `min <= version < maxExclusive` under `packaging.version.Version`
 * ordering. An absent, empty or unparsable `version` (or bound) is out of range,
 * as the shell's failing `Version(...)` call was.
 */
export function inRange(version: string | undefined, min: string, maxExclusive: string): boolean {
  const v = parseVersion(version);
  const lo = parseVersion(min);
  const hi = parseVersion(maxExclusive);
  if (v === undefined || lo === undefined || hi === undefined) return false;
  return compare(lo, v) <= 0 && compare(v, hi) < 0;
}

/**
 * The two `ERROR:` lines the four setups print, on stdout, when the installed
 * MemPalace is out of range (copied from the shell; an empty or absent version
 * prints as `(unknown)`, the shell's `${MEMPALACE_VERSION:-(unknown)}`).
 */
export function rangeErrorLines(
  version: string | undefined,
  min: string,
  maxExclusive: string,
): readonly string[] {
  const shown = version === undefined || version === "" ? "(unknown)" : version;
  return [
    `  ERROR: MemPalace ${shown} is outside the supported range >=${min},<${maxExclusive}.`,
    `         Install a supported version with: pipx install --force 'mempalace>=${min},<${maxExclusive}'`,
  ];
}
