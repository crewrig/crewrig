// import-oracle-lib.ts — the run machinery of the history-import oracle (spec
// 0253 PLAN v3, step A2). One `runImport` call builds a hermetic harness, writes
// the `python3` and `fzf` stubs, feeds the scripted answers BOTH on stdin (what a
// readline prompt reads) and through the `fzf` stub counter (what the shell
// version reads), runs `bash scripts/import-<cli>-history.sh` and returns the
// outcome. No `node` stub exists: the only stubs are programs the migration does
// not replace in the call chain.

import fs from "node:fs";
import path from "node:path";

import {
  createHermeticEnv,
  poisonHit,
  runBash,
  writeStub,
  type RunResult,
} from "./hermetic-env.ts";

export interface ImportOptions {
  /** Which script, e.g. "claude" for `scripts/import-claude-history.sh`. */
  readonly cli: string;
  /** Environment variable naming the source, and its value built from the harness root. */
  readonly sourceVar: string;
  readonly source: (root: string) => string;
  /** Fixture creation, run with the harness root, before the script starts. */
  readonly populate?: (root: string) => void;
  /** Answers to the two prompts, in order. */
  readonly answers?: readonly string[];
  /** Exit status of `python3 -c "import mempalace.mcp_server"`. */
  readonly importStatus?: number;
  /** Exit status of `python3 -m mempalace mine ...`. */
  readonly mineStatus?: number;
  /** Extra environment (MEMPALACE_HISTORY_WING and the like). */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ImportOutcome extends RunResult {
  /** One entry per `python3` call: its argv joined by single spaces. */
  readonly calls: readonly string[];
  readonly poisoned: boolean;
  /** The source path given to the script. */
  readonly source: string;
  /** Entries left in the TMPDIR the script ran with. */
  readonly tmpLeft: readonly string[];
}

const SCRIPTS = path.resolve(import.meta.dirname, "..", "..");

/** Run one import script under the hermetic harness and collect what it did. */
export function runImport(opts: ImportOptions): ImportOutcome {
  const h = createHermeticEnv();
  try {
    const log = path.join(h.root, "python-calls.log");
    const counter = path.join(h.root, "fzf-counter");
    const answers = path.join(h.root, "fzf-answers");
    const tmp = path.join(h.root, "tmp");
    fs.mkdirSync(tmp);
    fs.writeFileSync(path.join(h.root, "import-status"), `${opts.importStatus ?? 0}\n`);
    fs.writeFileSync(path.join(h.root, "mine-status"), `${opts.mineStatus ?? 0}\n`);
    const scripted = opts.answers ?? [];
    fs.writeFileSync(answers, scripted.map((a) => `${a}\n`).join(""));
    writeStub(
      h,
      "python3",
      `printf '%s\\n' "$*" >> '${log}'\n` +
        `if [ "$1" = "-c" ]; then exit "$(cat '${h.root}/import-status')"; fi\n` +
        `exit "$(cat '${h.root}/mine-status')"\n`,
    );
    writeStub(
      h,
      "fzf",
      `cat > /dev/null\n` +
        `n=$(cat '${counter}' 2>/dev/null || echo 0)\n` +
        `n=$((n + 1))\n` +
        `echo "$n" > '${counter}'\n` +
        `sed -n "\${n}p" '${answers}'\n`,
    );
    opts.populate?.(h.root);
    const source = opts.source(h.root);
    const res = runBash(h, path.join(SCRIPTS, `import-${opts.cli}-history.sh`), [], {
      input: scripted.map((a) => `${a}\n`).join(""),
      env: { [opts.sourceVar]: source, TMPDIR: tmp, ...opts.env },
    });
    return {
      ...res,
      calls: fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [],
      poisoned: poisonHit(h),
      source,
      tmpLeft: fs.readdirSync(tmp),
    };
  } finally {
    h.dispose();
  }
}

/** Write `files` (relative path to content) under `dir`, creating parents. */
export function writeFiles(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}
