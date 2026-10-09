// config.ts — `crewrig.config.toml`, placeholders, `canonical_repo` (spec 0250 R7).
//
// Twins scripts/build-components.sh `load_crewrig_config` (:193-211),
// `resolve_placeholders` (:220-231) and `validate_canonical_repo` (:235-244).
//
// The file is read line by line, not as TOML. The shell's `read` loop is
// reproduced point by point:
//   - a last line with no line terminator is not read;
//   - the line is split at its first `=`; a line with no `=` is a key with an
//     empty value (it registers an empty placeholder);
//   - the key is the text before it with every blank removed, skipped when empty or
//     starting with `#`;
//   - the value loses leading blanks and one optional quote, then the leftmost
//     match of an optional quote followed by blanks to the end of the line
//     (`sed -E 's/^[[:space:]]*"?//; s/"?[[:space:]]*$//'`), in that order;
//   - a repeated key keeps its last value but stays in the list once per line, as
//     `CFG_KEYS` did.
// Blank means the ASCII set of `[[:space:]]`. A key is the name part of a shell
// variable `CFG_<KEY>`, so letters, digits and underscores are accepted whatever
// the first one is (the shell took `1a`); any other key aborted the shell with
// `printf -v`'s "not a valid identifier", status 1 or 2, and is a status 1 here.

import fs from "node:fs";

import { joinRoot } from "./args.ts";
import { escapeControl } from "./diagnostics.ts";
import { BuildFailure } from "./types.ts";
import type { Config, Io, Placeholder } from "./types.ts";

const BLANKS = /[ \t\n\v\f\r]/g;
const LEADING = /^[ \t\n\v\f\r]*"?/;
const TRAILING = /"?[ \t\n\v\f\r]*$/;
const VALID_KEY = /^[A-Za-z0-9_]+$/;
// `^https://[^/[:space:]]+/[^/[:space:]]+/[^/[:space:]]+/?$`
const CANONICAL_REPO = /^https:\/\/[^/ \t\n\v\f\r]+\/[^/ \t\n\v\f\r]+\/[^/ \t\n\v\f\r]+\/?$/;

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The text of a file as `read` sees it: every line that ends with a line feed. */
function terminatedLines(text: string): string[] {
  const lines = text.split("\n");
  lines.pop();
  return lines;
}

/**
 * `load_crewrig_config`. A missing file writes the warning and yields no placeholder.
 *
 * @throws BuildFailure (status 1) on a key that is not a valid placeholder name.
 */
export function loadConfig(repoDir: string, platform: NodeJS.Platform, io: Io): Config {
  const file = joinRoot(platform, repoDir, "crewrig.config.toml");
  if (!isFile(file)) {
    io.err(`Warning: ${escapeControl(file)} not found — placeholders will be left literal.`);
    return { placeholders: [], canonicalRepo: "" };
  }
  const order: string[] = [];
  const values = new Map<string, string>();
  terminatedLines(fs.readFileSync(file, "utf8")).forEach((line, index) => {
    const eq = line.indexOf("=");
    const key = (eq < 0 ? line : line.slice(0, eq)).replace(BLANKS, "");
    if (key === "" || key.startsWith("#")) return;
    if (!VALID_KEY.test(key)) {
      throw new BuildFailure(
        `Error: ${escapeControl(file)}: line ${index + 1}: '${escapeControl(key)}' is not a valid placeholder name (letters, digits and underscores only)`,
      );
    }
    const raw = eq < 0 ? "" : line.slice(eq + 1);
    const upper = key.toUpperCase();
    values.set(upper, raw.replace(LEADING, "").replace(TRAILING, ""));
    order.push(upper);
  });
  const placeholders = order.map((key): Placeholder => ({ key, value: values.get(key) ?? "" }));
  return { placeholders, canonicalRepo: values.get("CANONICAL_REPO") ?? "" };
}

/**
 * `resolve_placeholders`: every `${KEY}` replaced by its value, all occurrences,
 * literally, one key after another in file order (so a value holding a later key's
 * placeholder is substituted by that key).
 */
export function resolvePlaceholders(config: Config, content: string): string {
  let result = content;
  for (const { key, value } of config.placeholders) {
    result = result.split(`\${${key}}`).join(value);
  }
  return result;
}

/**
 * `validate_canonical_repo`: an absent or empty value passes; anything else must be
 * `https://<host>/<owner>/<repo>` with an optional final slash.
 *
 * @throws BuildFailure (status 1), the two lines the shell wrote to standard error.
 */
export function validateCanonicalRepo(config: Config): void {
  const repo = config.canonicalRepo;
  if (repo === "" || CANONICAL_REPO.test(repo)) return;
  throw new BuildFailure(
    `Error: canonical_repo in crewrig.config.toml is malformed: '${escapeControl(repo)}'\n` +
      "Expected: https://<host>/<owner>/<repo> (no deeper path, no file:// scheme)",
  );
}
