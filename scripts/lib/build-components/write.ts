// write.ts — the check-versus-write decision for generated text (spec 0250 R9, R14, R16).
//
// Twins scripts/build-components.sh `check_or_write` (:382-408): splice the
// provenance block when a source is given, resolve placeholders, then either compare
// with the committed file (`--check` on a tier that is drift-compared) or write.
//
// Bytes. The shell's `content=$(...)` removed every trailing line feed and
// `echo "$content"` appended one: `finalizeText` is that, plus LF line endings
// (`toLf`, applied first so a trailing CRLF cannot leave two line feeds). The
// comparison is exact, on bytes. A new file is created with the default mode,
// `0666 & ~umask`, and a rewritten one keeps its mode, as the shell's `>` did:
// `tmp-file.ts` (owner-only files) is deliberately not the writer. Resources are
// not text and do not come through here (see resources.ts).

import fs from "node:fs";
import path from "node:path";

import { toLf } from "../line-endings.ts";
import { resolvePlaceholders } from "./config.ts";
import { escapeControl } from "./diagnostics.ts";
import { injectProvenance } from "./provenance.ts";
import { BuildFailure } from "./types.ts";
import type { Ctx, SourceDoc } from "./types.ts";

/** `$(...)` then `echo`: LF endings, every trailing line feed removed, exactly one appended. */
export function finalizeText(text: string): string {
  const lf = toLf(text);
  let end = lf.length;
  while (end > 0 && lf.charCodeAt(end - 1) === 10) end -= 1;
  return `${lf.slice(0, end)}\n`;
}

/** The shell's `[ -f ]`: a regular file, a symbolic link to one included. */
export function isRegularFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The shell's `diff -q` / `cmp -s`: true when the file reads and holds exactly `expected`. */
export function sameBytes(file: string, expected: Uint8Array): boolean {
  try {
    return Buffer.compare(fs.readFileSync(file), expected) === 0;
  } catch {
    return false;
  }
}

/** Report one drift the way `--check` does, on standard output, and remember it. */
export function reportDrift(ctx: Ctx, file: string, missing: boolean): void {
  ctx.io.out(
    missing
      ? `DRIFT: ${escapeControl(file)} does not exist (expected from source)`
      : `DRIFT: ${escapeControl(file)} differs from source`,
  );
  ctx.state.driftFound = true;
}

/** Whether this tier's outputs are compared with the committed tree rather than written. */
export function comparing(ctx: Ctx): boolean {
  return ctx.opts.check && ctx.state.compare;
}

/** Whether `target` resolves to a path strictly below `root` (case-blind on win32). */
function strictlyUnder(platform: NodeJS.Platform, root: string, target: string): boolean {
  const flavour = platform === "win32" ? path.win32 : path.posix;
  const fold = (text: string): string => (platform === "win32" ? text.toLowerCase() : text);
  const base = fold(flavour.resolve(root));
  const prefix = base.endsWith(flavour.sep) ? base : `${base}${flavour.sep}`;
  const resolved = fold(flavour.resolve(target));
  return resolved.startsWith(prefix) && resolved.length > prefix.length;
}

/**
 * Defence in depth behind `componentName` (tiers.ts): refuse a target that does not
 * resolve strictly under its output root, before anything is read, written or created.
 *
 * @throws BuildFailure (status 1) when the target leaves the root.
 */
export function assertInsideRoot(ctx: Pick<Ctx, "platform">, root: string, target: string): void {
  if (strictlyUnder(ctx.platform, root, target)) return;
  throw new BuildFailure(
    `Error: refusing to write outside the output root: ${escapeControl(target)}`,
  );
}

/**
 * `check_or_write <target_file> <content> [<source>]`. With a `source`, its
 * `metadata.provenance` block is spliced into `content` first; placeholders are
 * resolved after that. Prints `DRIFT:` lines (compare) or `  Generated: <file>` (write).
 * `root`, the output root the target belongs under, confines it (`assertInsideRoot`).
 */
export function checkOrWrite(
  ctx: Ctx,
  targetFile: string,
  content: string,
  source: SourceDoc | null,
  root: string,
): void {
  assertInsideRoot(ctx, root, targetFile);
  const spliced = source === null ? content : injectProvenance(content, source);
  const text = finalizeText(resolvePlaceholders(ctx.config, spliced));
  if (comparing(ctx)) {
    if (!isRegularFile(targetFile)) reportDrift(ctx, targetFile, true);
    else if (!sameBytes(targetFile, Buffer.from(text, "utf8"))) reportDrift(ctx, targetFile, false);
    return;
  }
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, text);
  ctx.io.out(`  Generated: ${escapeControl(targetFile)}`);
}
