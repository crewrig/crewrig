// harness-curator-cases.ts — the case table of the curator differential (spec 0258 R28, R29, PLAN v2
// step 19): `curate`, `setup-labels` and `schedule-curator`, each case run through the shell and the
// entry as black boxes. Every case name is a golden directory under fixtures/harness-curator/.

import fs from "node:fs";
import path from "node:path";

import { SCRIPTS_DIR } from "./harness-curator-observe.ts";
import type { HcCase } from "./harness-curator-observe.ts";
import {
  crontabStub,
  fzfStub,
  ghStub,
  managerStub,
  pipxStub,
  pythonStub,
  stub,
  unameStub,
} from "./harness-curator-stubs.ts";

const SAMPLE = fs.readFileSync(
  path.join(SCRIPTS_DIR, "..", "assets", "sample-frictions.json"),
  "latin1",
);
const CLUSTERS = '[{"cluster_key":"k1","target_repo":"https://github.com/o/r","title":"T"}]';

const cur = (name: string, args: string[], rest: Partial<HcCase> = {}): HcCase => ({
  name: `curate-${name}`,
  script: "curate",
  args,
  ...rest,
});
const LONE = [pythonStub()];
const REAL = { tools: ["python3"] };

const CURATE: HcCase[] = [
  cur("help", ["--help"]),
  cur("help-short", ["-h"]),
  cur("unknown-option", ["--bogus"]),
  ...["--threshold", "--max-issues", "--target-repo", "--deep-window"].map((opt) =>
    cur(`missing-value-${opt.slice(2)}`, ["--dry-run", opt], { deviations: ["(l)"] }),
  ),
  cur("threshold-zero", ["--threshold", "0"]),
  cur("threshold-text", ["--threshold", "two"]),
  cur("max-issues-negative", ["--max-issues", "-1"]),
  cur("max-issues-text", ["--max-issues", "many"]),
  cur("deep-with-apply", ["--deep", "--apply"], { stubs: LONE }),
  cur("bad-interpreter", [], { env: { MEMPALACE_PYTHON: "{ROOT}/missing/python" } }),
  cur("bad-interpreter-from-stdin", ["--from-stdin"], {
    env: { MEMPALACE_PYTHON: "{ROOT}/missing/python" },
    input: "[]\n",
  }),
  cur("bad-interpreter-fallback-python3", ["--from-stdin"], {
    env: { MEMPALACE_PYTHON: "{ROOT}/missing/python" },
    input: "[]\n",
    stubs: LONE,
  }),
  cur("no-python3", []),
  cur("no-python3-from-stdin", ["--from-stdin"], { input: "[]\n" }),
  cur("stdin-sample-dry-run", ["--from-stdin"], { ...REAL, input: SAMPLE }),
  cur("stdin-sample-threshold", ["--from-stdin", "--threshold", "1", "--max-issues", "2"], {
    ...REAL,
    input: SAMPLE,
  }),
  cur("stdin-crlf", ["--from-stdin"], { stubs: LONE, input: SAMPLE.replaceAll("\n", "\r\n") }),
  cur("stdin-empty", ["--from-stdin"], { stubs: LONE, input: "" }),
  cur("stdin-empty-real", ["--from-stdin"], { ...REAL, input: "" }),
  cur("stdin-not-json-real", ["--from-stdin"], { ...REAL, input: "not json\n" }),
  cur(
    "stub-argv-env",
    [
      "--target-repo",
      "https://github.com/o/r",
      "--threshold",
      "3",
      "--max-issues",
      "4",
      "--deep-window",
      "7",
    ],
    { stubs: [pythonStub({ out: CLUSTERS })] },
  ),
  cur("stub-deep", ["--deep", "--deep-window", "9"], {
    stubs: [pythonStub({ out: "# Review document\n\n- item" })],
  }),
  cur("python-exit-2", ["--from-stdin"], {
    stubs: [pythonStub({ exit: 2, err: "curate.py: boom" })],
    input: SAMPLE,
  }),
  cur("python-exit-2-apply", ["--apply"], {
    stubs: [pythonStub({ exit: 2, err: "curate.py: boom" }), ghStub()],
  }),
  cur("apply-without-gh", ["--apply"], { stubs: [pythonStub({ out: CLUSTERS })] }),
  cur("apply-gh", ["--apply"], { stubs: [pythonStub({ out: CLUSTERS }), ghStub()] }),
  cur("apply-gh-dedup", ["--apply", "--dedup", "--from-stdin"], {
    stubs: [pythonStub({ out: CLUSTERS }), ghStub()],
    input: "[]\n",
  }),
  cur("apply-fails", ["--apply"], {
    stubs: [pythonStub({ out: CLUSTERS, applyExit: 4 }), ghStub()],
  }),
  cur("dedup-dry-run", ["--dedup"], { stubs: [pythonStub({ out: CLUSTERS })] }),
  cur("pipx-venv", ["--apply", "--dedup"], {
    stubs: [
      pipxStub(),
      pythonStub({ out: CLUSTERS, where: "pipx/venvs/mempalace/bin/python3" }),
      ghStub(),
    ],
  }),
  cur("pipx-without-venv", [], { stubs: [pipxStub(), pythonStub({ out: CLUSTERS })] }),
  cur("pipx-ignored-with-env", [], {
    env: { MEMPALACE_PYTHON: "{ROOT}/bin/mp-python" },
    stubs: [pipxStub(), pythonStub({ out: CLUSTERS, where: "bin/mp-python" })],
  }),
];

const lab = (name: string, args: string[], rest: Partial<HcCase> = {}): HcCase => ({
  name: `setup-labels-${name}`,
  script: "setup-labels",
  args,
  ...rest,
});

const LABELS: HcCase[] = [
  lab("dry-run", ["--dry-run"]),
  lab("dry-run-repo", ["--repo", "o/r", "--dry-run"]),
  lab("help", ["--help"]),
  lab("help-short", ["-h"]),
  lab("bogus-argument", ["--bogus"]),
  lab("repo-without-value", ["--repo"]),
  lab("gh-absent", []),
  lab("gh-absent-repo", ["--repo", "o/r"]),
  lab("fourth-label-fails", ["--repo", "o/r"], { stubs: [ghStub({ failNth: 4 })] }),
  lab("first-and-last-fail", [], {
    stubs: [
      stub(
        "gh",
        `n=$(cat '{ROOT}/bin/.n' 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > '{ROOT}/bin/.n'\nif [ "$n" = 1 ]; then exit 1; fi\nif [ "$n" = 9 ]; then exit 1; fi\nexit 0\n`,
      ),
    ],
  }),
  lab("all-succeed-repo", ["--repo", "o/r"], { stubs: [ghStub()] }),
  lab("all-succeed", [], { stubs: [ghStub()] }),
];

const SCHEDULE = [
  unameStub(),
  fzfStub(),
  crontabStub(),
  ghStub(),
  managerStub("systemctl"),
  managerStub("launchctl"),
];
const SCHEDULE_ARGS = ["--frequency", "weekly", "--hour", "9"];
const sch = (name: string, args: string[], rest: Partial<HcCase> = {}): HcCase => ({
  name: `schedule-curator-${name}`,
  script: "schedule-curator",
  args,
  ...rest,
});

const SCHEDULER: HcCase[] = [
  sch("help", ["--help"]),
  sch("help-short", ["-h"]),
  sch("unknown-option", ["--bogus"]),
  sch("dry-run", ["--dry-run"], {
    entryArgs: ["--dry-run", ...SCHEDULE_ARGS],
    stubs: SCHEDULE,
    deviations: ["(f)"],
  }),
  sch("uninstall-clean", ["--uninstall"], { stubs: SCHEDULE, deviations: ["(f)"] }),
  sch("install-weekly", [], {
    entryArgs: SCHEDULE_ARGS,
    stubs: SCHEDULE,
    deviations: ["(f)"],
  }),
  sch("gh-absent", ["--dry-run"], {
    entryArgs: ["--dry-run", ...SCHEDULE_ARGS],
    stubs: [unameStub(), fzfStub()],
  }),
  sch("gh-not-authenticated", ["--dry-run"], {
    entryArgs: ["--dry-run", ...SCHEDULE_ARGS],
    stubs: [unameStub(), fzfStub(), ghStub({ authExit: 1 })],
  }),
  sch("no-checkout", ["--dry-run"], {
    entryArgs: ["--dry-run", ...SCHEDULE_ARGS],
    stubs: SCHEDULE,
    alone: true,
    deviations: ["(n)"],
  }),
];

export const CASES: readonly HcCase[] = [...CURATE, ...LABELS, ...SCHEDULER];
