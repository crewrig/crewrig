// skill-scripts-deviations.ts — the TAGGED differences between the shell leg and the entry leg of
// a skill script (spec 0258 R31), for the differential proof in skill-scripts-differential.test.ts.
// A case carries its tags in `deviation` (`(o)`, `c`, `c,e`, ...); a tag names a FOLD: the
// canonical form of a text in which the tagged difference no longer shows. A difference is
// explained when both legs agree after the folds of the case's tags (and always after (a)); a
// difference no fold of the case removes is UNTAGGED and fails the test, naming the case.
// Letters: (a) the script name token, (b) ordering, (c) lint-json message text, the vanished
// `jq not found` note and the `<stdin>` name, (d) lint-skill's js-yaml note, (e) temp names, (m)
// lint-json strictness, (o) bash's `Terminated` job message when a wrapped tool dies of SIGTERM.

/** `script` is the script name without its extension. */
export type Fold = (text: string, script: string) => string;

export interface Tag {
  readonly letter: string;
  readonly why: string;
  /** Golden keys the tag may touch (`status`, `stdout`, `stderr`, `files/`, ...), by prefix. */
  readonly keys: readonly string[];
  readonly fold: Fold;
}

const DASH = "(?:—|â\u0080\u0094)"; // the em dash, as text or as latin1 UTF-8 bytes
const lines = (text: string): string[] => text.split("\n");
const dropLines = (text: string, drop: RegExp): string =>
  lines(text)
    .filter((line) => !drop.test(line))
    .join("\n");

export const TAGS: readonly Tag[] = [
  {
    letter: "a",
    why: "the script name token ends in .ts, not .sh (the observer already strips it)",
    keys: ["stdout.", "stderr."],
    fold: (text, script) =>
      text.replaceAll(`${script}.sh`, script).replaceAll(`${script}.ts`, script),
  },
  {
    letter: "b",
    why: "files are listed in byte order of their path, find printed directory order",
    keys: ["stdout.", "stderr.", "files/"],
    fold: (text) => lines(text).sort().join("\n"),
  },
  {
    letter: "c",
    why: "lint-json reports JSON.parse's own message, the jq-not-found note vanishes",
    keys: ["stdout.", "status."],
    fold: (text) =>
      dropLines(text, new RegExp(`^lint-json: jq not found ${DASH} `)).replaceAll(
        new RegExp(`(invalid JSON ${DASH} ).*`, "g"),
        "$1<JSON-MSG>",
      ),
  },
  {
    letter: "d",
    why: "lint-skill parses with js-yaml, not yq: its fallback note names js-yaml",
    keys: ["stdout."],
    fold: (text) =>
      text.replace(
        new RegExp(
          `^lint-skill: (?:yq not found ${DASH} using grep fallback for required keys\\.|js-yaml not found ${DASH} using line fallback .*)$`,
          "m",
        ),
        "<FALLBACK-NOTE>",
      ),
  },
  {
    letter: "e",
    why: "standard input is named <stdin>, the shell printed a generated temp name",
    keys: ["stdout."],
    fold: (text) => text.replaceAll(/<TMP>\/<RAND>|<stdin>/g, "<STDIN-NAME>"),
  },
  {
    letter: "m",
    why: "lint-json rejects what JSON.parse rejects, stricter than jq empty",
    keys: ["stdout.", "status."],
    fold: (text) => dropLines(text, new RegExp(` invalid JSON ${DASH} `)),
  },
  {
    letter: "o",
    why: "bash prints `Terminated` when a wrapped tool dies of SIGTERM, the entry prints nothing",
    keys: ["stderr."],
    fold: (text) => dropLines(text, /^Terminated$/),
  },
];

const BY_LETTER = new Map(TAGS.map((tag) => [tag.letter, tag]));

/** The tags of a case's `deviation` field; an unknown letter throws. */
export function tagsOf(deviation: string | undefined): Tag[] {
  return (deviation ?? "")
    .split(",")
    .map((raw) => raw.replace(/[()]/g, "").trim())
    .filter((letter) => letter !== "")
    .map((letter) => {
      const tag = BY_LETTER.get(letter);
      if (tag === undefined) throw new Error(`unknown deviation tag: ${letter}`);
      return tag;
    });
}

const fileText = (key: string): boolean => !key.startsWith("status.");

/**
 * Why a differing golden key is explained by the case's tags, or undefined when it is untagged.
 * `shell` and `entry` are the stored texts of the key; `entryStdout` is the entry's whole stdout,
 * `script` the script name.
 */
export function explain(
  key: string,
  shell: string | undefined,
  entry: string | undefined,
  tags: readonly Tag[],
  entryStdout: string,
  script: string,
): string | undefined {
  if (shell === undefined || entry === undefined) return undefined; // an overlay cannot express it
  const letters = tags.map((tag) => tag.letter);
  if (key === "status.golden") {
    // jq absent or lenient: the shell exits 0 where the entry reports `invalid JSON` and exits 1
    const lenient = letters.some((l) => l === "c" || l === "m");
    return lenient && shell === "0\n" && entry === "1\n" && entryStdout.includes("invalid JSON")
      ? letters.filter((l) => l === "c" || l === "m").join(",")
      : undefined;
  }
  if (!fileText(key)) return undefined;
  // CANDIDATE, no letter of the spec fits: without `jq` the shell skips the parse (exit 0, a
  // note), the entry always parses. Accepted only where the shell printed the note and the case
  // already carries (c) or (m); it needs a spec delta that names it.
  const noJq =
    (letters.includes("c") || letters.includes("m")) &&
    shell.includes("lint-json: jq not found") &&
    key.startsWith("stdout.");
  const allowed = [...tags, ...(noJq ? [BY_LETTER.get("c"), BY_LETTER.get("m")] : [])].filter(
    (tag): tag is Tag => tag !== undefined && tag.keys.some((prefix) => key.startsWith(prefix)),
  );
  const fold = (text: string): string =>
    [BY_LETTER.get("a") as Tag, ...allowed].reduce((acc, tag) => tag.fold(acc, script), text);
  return fold(shell) === fold(entry)
    ? allowed.map((tag) => tag.letter).join(",") + (noJq ? "+no-jq" : "")
    : undefined;
}

/** The keys a tag set may overlay at all (an overlay outside them is a stray). */
export function mayOverlay(key: string, tags: readonly Tag[]): boolean {
  return tags.some((tag) => tag.keys.some((prefix) => key.startsWith(prefix)));
}
