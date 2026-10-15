// harness-curator-differential.ts — the deviation table, the difference finder and the stored form
// of the observations of the curator differential (spec 0258 R28, R29, R31; PLAN v2 step 19).
//
// Every difference between the shell leg and the entry leg must match a rule of RULES whose tag the
// case declares (`deviations`); an untagged one fails the test naming it. Tags are the letters of
// spec requirement 31. Two differences are hidden by normalisation instead of a rule, and are
// documented in `normalise` (harness-curator-stubs.ts): (a) the `.sh`/`.ts` spelling of the script's
// own path, and (e) the random suffix of the temporary file. After the switch the shell leg is gone
// and the entry is compared with the committed goldens and overlays.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { HcCase, Observed, ResolvedLeg } from "./harness-curator-observe.ts";

export interface Difference {
  /** `status`, `stdout`, `stderr`, `calls`, `tmp-left` or `file <rel>`. */
  readonly field: string;
  readonly shell: string;
  readonly ts: string;
}

export interface Rule {
  readonly tag: string;
  readonly why: string;
  readonly matches: (diff: Difference) => boolean;
}

const REACTIVE = "Reactive trigger (run manually when a severity:high friction is filed):";
const lines = (text: string): string[] => text.split("\n");

/** The installer's stdout in three parts: the banner, the schedule definition and the reactive tail. */
function parts(text: string): { banner: string; definition: string; tail: string } | undefined {
  const at = text.indexOf(`\n${REACTIVE}`);
  const bannerEnd = text.indexOf("Logfile:");
  if (at < 0 || bannerEnd < 0) return undefined;
  const afterBanner = text.indexOf("\n\n", bannerEnd) + 2;
  return {
    banner: text.slice(0, afterBanner),
    definition: text.slice(afterBanner, at),
    tail: text.slice(at).replace(/^( {4})(?:bash|node) /m, "$1<INTERPRETER> "),
  };
}

export const RULES: readonly Rule[] = [
  {
    tag: "(l)",
    why: "an option that needs a value and is given none: the shell died with `unbound variable` (exit 1), the entry reports a usage error (exit 1)",
    matches: (d) =>
      d.field === "stderr" &&
      d.shell.includes("unbound variable") &&
      /^Error: --[a-z-]+ requires a value\n/.test(d.ts),
  },
  {
    tag: "(f)",
    why: "schedule-curator, Linux: the entry registers a systemd user timer where the shell wrote a crontab entry; the banner and the reactive tail are equal (the interpreter word aside)",
    matches: (d) => {
      if (d.field === "stdout") {
        const a = parts(d.shell);
        const b = parts(d.ts);
        return (
          a !== undefined &&
          b !== undefined &&
          a.banner === b.banner &&
          a.tail === b.tail &&
          /crontab|cron entry|crewrig-harness-curator/.test(a.definition) &&
          /\[Timer\]|Enabled and scheduled/.test(b.definition)
        );
      }
      if (d.field === "calls") {
        const cron = (l: string): boolean =>
          /^(crontab |  cron-input:|# crewrig-harness-curator|\d+ \d+ \* \* )/.test(l);
        const ctl = (l: string): boolean => l.startsWith("systemctl ");
        return (
          d.shell.includes("crontab ") &&
          lines(d.shell)
            .filter((l) => !cron(l))
            .join("\n") ===
            lines(d.ts)
              .filter((l) => !ctl(l))
              .join("\n")
        );
      }
      if (d.field.startsWith("file home/.config/systemd/user/"))
        return d.shell === "<absent>" && d.ts.includes("[Unit]");
      return false;
    },
  },
  {
    tag: "(f)",
    why: "schedule-curator --uninstall with nothing registered: both say `nothing to remove`; the entry names the systemd timer and adds the one line about a crontab entry of an earlier version",
    matches: (d) =>
      d.field === "stdout" &&
      d.shell === "No managed crontab entry — nothing to remove.\n" &&
      /^No managed systemd timer at \S+ — nothing to remove\.\nNote: .*# crewrig-harness-curator.*\n$/.test(
        d.ts,
      ),
  },
  {
    tag: "(n)",
    why: "schedule-curator copied alone: both exit 1 with an error on stderr; the shell misses curate.sh beside itself, the entry misses the CrewRig checkout",
    matches: (d) =>
      d.field === "stderr" &&
      /^Error: curate\.sh not found at /.test(d.shell) &&
      /^Error: schedule-curator needs a CrewRig checkout: /.test(d.ts),
  },
  {
    tag: "(n)",
    why: "schedule-curator copied alone: the entry looks for the checkout before it asks `gh auth status`, the shell asked first and looked for curate.sh last",
    matches: (d) => d.field === "calls" && d.shell === "gh <auth> <status>\n" && d.ts === "",
  },
];

/** The tag of the rule a difference matches among the tags the case declares, or undefined. */
export function tagOf(diff: Difference, testCase: HcCase): string | undefined {
  const declared = testCase.deviations ?? [];
  // Streams are held as latin1 strings (a byte stays a byte); the rules read them as UTF-8.
  const text = (value: string): string => Buffer.from(value, "latin1").toString("utf8");
  const decoded = { field: diff.field, shell: text(diff.shell), ts: text(diff.ts) };
  return RULES.find((r) => declared.includes(r.tag) && r.matches(decoded))?.tag;
}

/** Every difference between the shell and the entry observation of one case. */
export function findDifferences(shell: Observed, ts: Observed): Difference[] {
  const out: Difference[] = [];
  const add = (field: string, a: string, b: string): void =>
    void (a === b || out.push({ field, shell: a, ts: b }));
  add("status", shell.status, ts.status);
  add("stdout", shell.stdout, ts.stdout);
  add("stderr", shell.stderr, ts.stderr);
  add("calls", shell.calls, ts.calls);
  add("tmp-left", shell.tmpLeft.join("\n"), ts.tmpLeft.join("\n"));
  for (const rel of new Set([...Object.keys(shell.files), ...Object.keys(ts.files)]))
    add(`file ${rel}`, shell.files[rel] ?? "<absent>", ts.files[rel] ?? "<absent>");
  return out;
}

// --- Stored form: fixtures/harness-curator/<case>/{status,stdout,stderr,calls}.golden --------
// plus `tmp-left.golden` when the temp directory was not left empty and `files/**` for each file
// written. Every stored name ends in `.golden`; no stored file starts with `#!`.

export const GOLDEN_ROOT = path.resolve(import.meta.dirname, "..", "fixtures", "harness-curator");
const OVERLAY = ".overlay.golden";

/** Stored files, relative to the case directory, with their latin1 content. */
export type GoldenFiles = Map<string, string>;

const encode = (rel: string): string =>
  rel
    .split("/")
    .map((s) =>
      s.replace(/[^A-Za-z0-9._@-]/g, (ch) =>
        Array.from(
          Buffer.from(ch, "utf8"),
          (b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`,
        ).join(""),
      ),
    )
    .join("/");

export function goldenFiles(obs: Observed): GoldenFiles {
  const out: GoldenFiles = new Map([
    ["status.golden", `${obs.status}\n`],
    ["stdout.golden", obs.stdout],
    ["stderr.golden", obs.stderr],
    ["calls.golden", obs.calls],
  ]);
  if (obs.tmpLeft.length > 0) out.set("tmp-left.golden", `${obs.tmpLeft.join("\n")}\n`);
  for (const [rel, text] of Object.entries(obs.files)) {
    out.set(
      text.startsWith("#!") ? `files/${encode(rel)}.shebang.golden` : `files/${encode(rel)}.golden`,
      text.startsWith("#!")
        ? `sha256 ${crypto.createHash("sha256").update(text, "latin1").digest("hex")}\n`
        : text,
    );
  }
  return out;
}

/** The overlay keys of a stored set (`stdout.overlay.golden`, `files/x.overlay.golden`, ...). */
export const overlayKeys = (stored: GoldenFiles): string[] =>
  [...stored.keys()].filter((k) => k.endsWith(OVERLAY));

/** What a leg is compared with: the shell leg the base goldens, the entry leg each overlay in place of its base. */
export function expectedFor(stored: GoldenFiles, leg: ResolvedLeg): GoldenFiles {
  const out: GoldenFiles = new Map();
  for (const [key, content] of stored) if (!key.endsWith(OVERLAY)) out.set(key, content);
  if (leg === "entry")
    for (const key of overlayKeys(stored))
      out.set(`${key.slice(0, -OVERLAY.length)}.golden`, stored.get(key) as string);
  return out;
}

/** The base keys whose entry value differs from the shell one: the overlays a case must carry. */
export function overlayBaseKeys(shell: GoldenFiles, entry: GoldenFiles): string[] {
  return [...entry.keys()].filter((k) => shell.get(k) !== entry.get(k)).sort();
}

export const caseDir = (name: string): string => path.join(GOLDEN_ROOT, name);

export function readGolden(name: string): GoldenFiles {
  const out: GoldenFiles = new Map();
  const walk = (dir: string, rel: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), at);
      else out.set(at, fs.readFileSync(path.join(dir, entry.name)).toString("latin1"));
    }
  };
  walk(caseDir(name), "");
  return out;
}

/** Replace the whole stored case directory. */
export function writeGolden(name: string, files: GoldenFiles): void {
  const dir = caseDir(name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(content, "latin1"));
  }
}

/** Human-readable differences between two stored sets, empty when equal. */
export function compareGolden(actual: GoldenFiles, expected: GoldenFiles): string[] {
  const out: string[] = [];
  for (const rel of new Set([...actual.keys(), ...expected.keys()])) {
    const a = actual.get(rel);
    const e = expected.get(rel);
    if (a === undefined) out.push(`${rel}: stored but not produced`);
    else if (e === undefined) out.push(`${rel}: produced but not stored`);
    else if (a !== e) out.push(`${rel}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
  return out;
}
