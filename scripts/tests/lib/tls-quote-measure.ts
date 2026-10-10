// tls-quote-measure.ts — measure what Bash's `printf %q` leaves bare (spec 0256
// requirement 19). A test helper: it spawns the bashes of the machine and
// reports, per bash and locale, which printable ASCII characters stay bare in
// each position of a word. The committed table is the safe intersection.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

export interface BashVariant {
  readonly bash: string;
  readonly locale: string;
}

export interface Measured {
  readonly variant: BashVariant;
  readonly version: string;
  /** Bare as the whole word (`c`). */
  readonly alone: string;
  /** Bare as the first character (`ca`). */
  readonly lead: string;
  /** Bare between letters (`aca`). */
  readonly mid: string;
  /** Bare as the last character (`ac`). */
  readonly trail: string;
  /** Characters `p` for which `p~` has its tilde escaped. */
  readonly tildeEscapedAfter: string;
}

export interface AlphabetTable {
  /** Bare in every position and every measured bash. */
  readonly bare: string;
  /** Bare except as the first character. */
  readonly bareNotFirst: string;
  /** Characters after which a `~` is escaped. */
  readonly tildeEscapedAfter: string;
  /** Every other printable ASCII character: escaped with a backslash. */
  readonly escaped: string;
}

export const PRINTABLE: readonly string[] = Array.from({ length: 95 }, (_, i) =>
  String.fromCharCode(32 + i),
);

/** `printf %q` of each word, in one bash process: NUL-delimited, `printf -v` works on Bash 3.2. */
export function shellQuote(variant: BashVariant, words: readonly string[]): string[] {
  const script = 'for w in "$@"; do printf -v q %q "$w"; printf "%s\\0" "$q"; done';
  const run = spawnSync(variant.bash, ["-c", script, "_", ...words], {
    env: { PATH: process.env["PATH"] ?? "", LC_ALL: variant.locale },
    encoding: "buffer",
  });
  if (run.status !== 0) throw new Error(`${variant.bash} failed: ${String(run.stderr)}`);
  const parts = run.stdout.toString("latin1").split("\0");
  parts.pop();
  return parts;
}

function bashVersion(bash: string): string {
  const run = spawnSync(bash, ["-c", 'printf %s "$BASH_VERSION"'], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : "";
}

function localeAvailable(bash: string, locale: string): boolean {
  const run = spawnSync(bash, ["-c", "locale charmap"], {
    env: { PATH: process.env["PATH"] ?? "", LC_ALL: locale },
    encoding: "utf8",
  });
  return run.status === 0 && run.stdout.trim().toUpperCase() === "UTF-8";
}

/** The PATH `bash` and `/bin/bash` (when they are different programs), under `C` and `en_US.UTF-8` when it exists. */
export function bashVariants(): BashVariant[] {
  if (process.platform === "win32") return [];
  const bashes: string[] = [];
  const seen = new Set<string>();
  for (const candidate of ["bash", "/bin/bash"]) {
    const found = candidate === "bash" ? whichBash() : candidate;
    if (found === undefined || !existsSync(found)) continue;
    const real = realpathSync(found);
    if (seen.has(real)) continue;
    seen.add(real);
    bashes.push(found);
  }
  const variants: BashVariant[] = [];
  for (const bash of bashes) {
    variants.push({ bash, locale: "C" });
    if (localeAvailable(bash, "en_US.UTF-8")) variants.push({ bash, locale: "en_US.UTF-8" });
  }
  return variants;
}

function whichBash(): string | undefined {
  for (const dir of (process.env["PATH"] ?? "").split(":")) {
    if (dir !== "" && existsSync(`${dir}/bash`)) return `${dir}/bash`;
  }
  return undefined;
}

function bareOf(variant: BashVariant, build: (c: string) => string): string {
  const words = PRINTABLE.map(build);
  const quoted = shellQuote(variant, words);
  return PRINTABLE.filter((_, i) => quoted[i] === words[i]).join("");
}

export function measure(variant: BashVariant): Measured {
  const tildeWords = PRINTABLE.map((c) => `${c}~`);
  const tildeQuoted = shellQuote(variant, tildeWords);
  return {
    variant,
    version: bashVersion(variant.bash),
    alone: bareOf(variant, (c) => c),
    lead: bareOf(variant, (c) => `${c}a`),
    mid: bareOf(variant, (c) => `a${c}a`),
    trail: bareOf(variant, (c) => `a${c}`),
    tildeEscapedAfter: PRINTABLE.filter(
      (c, i) => c !== "\\" && (tildeQuoted[i] as string).endsWith("\\~") && c !== "~",
    ).join(""),
  };
}

function intersect(sets: readonly string[]): string[] {
  return PRINTABLE.filter((c) => sets.every((s) => s.includes(c)));
}

/** The safe table: bare only where every measured bash leaves it bare; a tilde escaped when any does. */
export function intersectTable(all: readonly Measured[]): AlphabetTable {
  const everywhere = intersect(all.flatMap((m) => [m.alone, m.lead, m.mid, m.trail]));
  const notFirst = intersect(all.flatMap((m) => [m.mid, m.trail])).filter(
    (c) => !everywhere.includes(c),
  );
  const tilde = PRINTABLE.filter((c) => all.some((m) => m.tildeEscapedAfter.includes(c)));
  const escaped = PRINTABLE.filter((c) => !everywhere.includes(c) && !notFirst.includes(c));
  return {
    bare: everywhere.join(""),
    bareNotFirst: notFirst.join(""),
    tildeEscapedAfter: tilde.join(""),
    escaped: escaped.join(""),
  };
}

export function measureAll(): { measured: Measured[]; table: AlphabetTable } {
  const measured = bashVariants().map(measure);
  return { measured, table: intersectTable(measured) };
}
