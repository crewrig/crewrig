// prune-transcripts-oracle.test.ts — behavioural oracle for
// `bash scripts/prune-transcripts.sh` (spec 0253, delta-01 R18, R25 items 8-9,
// R26; PLAN v3 step A3). The script is driven as a black box under the hermetic
// harness; MEMPALACE_PYTHON is a recording stub that drains the Python body from
// stdin and dumps the environment the script hands to it. The same file must
// pass today against the shell script and, unchanged, once the script is a shim
// to the TypeScript entry (PR C). Deliberately NOT asserted, because delta-01
// lists them as deviations: the exact `Usage:` line of --help, the "unbound
// variable" message for a flag with no value, and the malformed tls-env.sh path.
// POSIX only: skipped on win32.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createHermeticEnv, poisonHit, runBash, writeStub } from "./lib/hermetic-env.ts";
import type { RunResult } from "./lib/hermetic-env.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(REPO, "scripts", "prune-transcripts.sh");

const RECORDED = [
  "TRANSCRIPTS_WING",
  "PROJECT_FILTER",
  "CUTOFF_DATE",
  "DRY_RUN",
  "MEMPALACE_INSTALL_SPEC",
  "SSL_CERT_FILE",
] as const;

/** Read one `NAME=value` pin line of scripts/lib/common.sh. */
function pin(name: string): string {
  const text = fs.readFileSync(path.join(REPO, "scripts", "lib", "common.sh"), "utf8");
  const match = new RegExp(`^${name}="([^"]+)"`, "m").exec(text);
  assert.ok(match?.[1], `pin ${name} found in common.sh`);
  return match[1];
}

/** `YYYY-MM-DD` of local today minus `days`, by local calendar arithmetic. */
function cutoff(days: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Run extends RunResult {
  readonly record: Record<string, string> | undefined;
  readonly before: string;
  readonly after: string;
}

/** Run the script under a fresh harness with a recording interpreter stub. */
function run(
  args: readonly string[],
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    tlsFile?: string;
    python?: string;
  } = {},
): Run {
  const h = createHermeticEnv({ poisonPython: false });
  try {
    const recordFile = path.join(h.root, "record");
    const lines = RECORDED.map(
      (v) => `printf '%s=%s\\n' ${v} "\${${v}-<unset>}" >> '${recordFile}'`,
    );
    const stub = writeStub(h, "recording-python", `cat > /dev/null\n${lines.join("\n")}\nexit 0\n`);
    if (options.tlsFile !== undefined) {
      fs.mkdirSync(path.join(h.home, ".crewrig"));
      fs.writeFileSync(path.join(h.home, ".crewrig", "tls-env.sh"), options.tlsFile);
    }
    const before = cutoff(30);
    const res = runBash(h, SCRIPT, args, {
      env: { MEMPALACE_PYTHON: options.python ?? stub, ...options.env },
    });
    const record: Record<string, string> | undefined = fs.existsSync(recordFile)
      ? Object.fromEntries(
          fs
            .readFileSync(recordFile, "utf8")
            .trim()
            .split("\n")
            .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
        )
      : undefined;
    assert.equal(poisonHit(h), false, "poison interpreter never reached");
    return { ...res, record, before, after: cutoff(30) };
  } finally {
    h.dispose();
  }
}

/** The recorded value of `name`, failing the test when the stub never ran. */
function recorded(r: Run, name: string): string {
  assert.ok(r.record, `interpreter stub ran; stderr: ${r.stderr}`);
  const value = r.record[name];
  assert.ok(value !== undefined, `${name} recorded`);
  return value;
}

describe("prune-transcripts oracle", { skip: process.platform === "win32" }, () => {
  test("--days 30 hands the interpreter a dry-run environment with the pinned install spec", () => {
    const r = run(["--days", "30"]);
    assert.equal(r.status, 0);
    assert.equal(recorded(r, "DRY_RUN"), "true");
    assert.equal(recorded(r, "TRANSCRIPTS_WING"), "transcripts");
    assert.equal(recorded(r, "PROJECT_FILTER"), "");
    assert.equal(
      recorded(r, "MEMPALACE_INSTALL_SPEC"),
      `mempalace>=${pin("MEMPALACE_MIN_VERSION")},<${pin("MEMPALACE_MAX_VERSION_EXCLUSIVE")}`,
    );
    // Accept either side of a midnight crossing during the run.
    assert.ok(
      [r.before, r.after].includes(recorded(r, "CUTOFF_DATE")),
      "CUTOFF_DATE is today - 30",
    );
  });

  test("no --days defaults to 30 days", () => {
    const r = run([]);
    assert.equal(r.status, 0);
    assert.ok([r.before, r.after].includes(recorded(r, "CUTOFF_DATE")));
    assert.match(r.stdout, /\(older than 30 days\)/);
  });

  test("--days 7 moves the cutoff accordingly", () => {
    const before = cutoff(7);
    const r = run(["--days", "7"]);
    assert.equal(r.status, 0);
    assert.ok([before, cutoff(7)].includes(recorded(r, "CUTOFF_DATE")), "CUTOFF_DATE is today - 7");
    assert.match(r.stdout, /\(older than 7 days\)/);
  });

  test("--apply flips DRY_RUN to false", () => {
    const r = run(["--apply"]);
    assert.equal(r.status, 0);
    assert.equal(recorded(r, "DRY_RUN"), "false");
    assert.match(r.stdout, /^Dry run: {5}false$/m);
  });

  test("--project x sets PROJECT_FILTER and shows it in the banner", () => {
    const r = run(["--project", "x"]);
    assert.equal(r.status, 0);
    assert.equal(recorded(r, "PROJECT_FILTER"), "x");
    assert.match(r.stdout, /^Project: +x \(filter only\)$/m);
  });

  test("the banner names the wing, cutoff and dry-run state, and omits Project when unfiltered", () => {
    const r = run([]);
    assert.match(r.stdout, /Transcript Prune/);
    assert.match(r.stdout, /^Wing: +transcripts$/m);
    assert.match(r.stdout, /^Cutoff date: \d{4}-\d{2}-\d{2} \(older than 30 days\)$/m);
    assert.match(r.stdout, /^Dry run: +true$/m);
    assert.doesNotMatch(r.stdout, /^Project:/m);
  });

  test("--days 0 is rejected as below the minimum", () => {
    const r = run(["--days", "0"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^Error: --days must be at least 1$/m);
    assert.equal(r.record, undefined);
  });

  for (const bad of ["x", "-3"]) {
    test(`--days ${bad} is rejected as not a positive integer`, () => {
      const r = run(["--days", bad]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /^Error: --days must be a positive integer$/m);
      assert.equal(r.record, undefined);
    });
  }

  test("an unknown option is named, with a --help hint, and exits 1", () => {
    const r = run(["--bogus"]);
    assert.equal(r.status, 1);
    const [first, second] = r.stderr.split("\n");
    assert.equal(first, "Unknown option: --bogus");
    assert.match(second ?? "", /^Run '.*prune-transcripts\.sh --help' for usage\.$/);
    assert.equal(r.record, undefined);
  });

  for (const flag of ["--help", "-h"]) {
    test(`${flag} lists the options and the pipx prerequisite, exit 0`, () => {
      const r = run([flag]);
      assert.equal(r.status, 0);
      for (const opt of ["--days", "--apply", "--project"]) {
        assert.match(r.stdout, new RegExp(`^ +${opt} `, "m"));
      }
      assert.match(r.stdout, /Prerequisites:/);
      assert.match(r.stdout, /MemPalace must be installed via pipx/);
      assert.equal(r.record, undefined);
    });
  }

  test("a missing interpreter is reported with the pipx install line", () => {
    const missing = "/nonexistent-dir/python-missing";
    const r = run([], { python: missing });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`^Error: ${missing} not found$`, "m"));
    assert.match(r.stderr, /^Install MemPalace via pipx: /m);
    assert.equal(r.record, undefined);
  });

  test("a tls-env.sh file overrides an inherited SSL_CERT_FILE", () => {
    const r = run([], {
      tlsFile: "export SSL_CERT_FILE=/tmp/from-file.pem\n",
      env: { SSL_CERT_FILE: "/tmp/inherited.pem" },
    });
    assert.equal(r.status, 0);
    assert.equal(recorded(r, "SSL_CERT_FILE"), "/tmp/from-file.pem");
  });

  test("without a tls-env.sh file the inherited SSL_CERT_FILE is kept", () => {
    const r = run([], { env: { SSL_CERT_FILE: "/tmp/inherited.pem" } });
    assert.equal(r.status, 0);
    assert.equal(recorded(r, "SSL_CERT_FILE"), "/tmp/inherited.pem");
  });
});
