// golden-normalize.ts — placeholders for golden data (spec 0248 R18, plan step 20).

import fs from "node:fs";
import path from "node:path";

import { nowEpoch, read } from "./worktree-fixtures.ts";

export interface PlaceholderContext {
  readonly main: string;
  readonly wt: string;
  readonly common: string;
  /** Extra directories to name, e.g. a working directory outside every repository. */
  readonly extra?: Record<string, string>;
}

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;

/**
 * Replace what varies between runs: the physical fixture paths, every ISO
 * timestamp and the `held-for-seconds` count. Longest path first, so the
 * worktree is named before the main checkout it sits in.
 */
export function placeholder(text: string, ctx: PlaceholderContext): string {
  const named: Array<[string, string]> = [
    [ctx.wt, "<WORKTREE>"],
    [ctx.common, "<COMMON>"],
    [ctx.main, "<MAIN>"],
    ...Object.entries(ctx.extra ?? {}).map(([name, dir]): [string, string] => [dir, `<${name}>`]),
  ];
  named.sort((a, b) => b[0].length - a[0].length);
  let out = text;
  for (const [dir, token] of named) out = out.split(dir).join(token);
  return out
    .replace(ISO, "<ISO>")
    .replace(/held-for-seconds: \d+/g, "held-for-seconds: <N>")
    .replace(/worktree-claim\.(?:sh|ts)/g, "<TOOL>")
    .replace(/(?:bash scripts\/<TOOL>|node scripts\/<TOOL>)/g, "<INVOKE>");
}

/** A `since_epoch` value within two hours of now is a clock reading, not data. */
function epochPlaceholder(content: string): string {
  const match = /^(\d{10})\n$/.exec(content);
  if (match === null) return content;
  return Math.abs(Number(match[1]) - nowEpoch()) < 7200 ? "<EPOCH>\n" : content;
}

/** Every file under the claim root (claim directories and ledgers), placeholdered, by relative path. */
export function snapshotClaimRoot(
  claimRoot: string,
  ctx: PlaceholderContext,
): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        // An empty directory is itself state: `[ -d ]` reads it as claimed.
        if (fs.readdirSync(full).length === 0) {
          files[`${path.relative(claimRoot, full).split(path.sep).join("/")}/`] = "";
        }
      } else {
        const rel = path.relative(claimRoot, full).split(path.sep).join("/");
        files[rel] = placeholder(epochPlaceholder(read(full)), ctx);
      }
    }
  };
  walk(claimRoot);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
