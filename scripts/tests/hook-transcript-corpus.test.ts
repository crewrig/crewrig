// hook-transcript-corpus.test.ts — recognition by content of the MemPalace
// transcript command, in both twins (spec 0247 R24, delta-01; scenarios "The
// transcript predicates agree, and guard ownership is unchanged", "A chained
// operator command is never touched", "Other arguments are never a transcript
// command").
//
// One corpus, fixtures/mempalace-transcript/recognition-corpus.json, is run
// through the TypeScript recogniser (scripts/lib/transcript-recognition.ts),
// through `hook-wiring.ts transcript classify`, and through the Bash twin
// `sr_transcript_class` of scripts/lib/usage-capture-optin.sh. `sr_is_own` is
// then checked to be "transcript class owned, or a guard", with the guard half
// held to C2's own corpus. Bash legs are POSIX only.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  classifyTranscript,
  OWN_CLASSES,
  type TranscriptClass,
} from "../lib/transcript-recognition.ts";
import { lookupHook } from "../lib/hook-registry.ts";
import { bashLibs } from "./lib/bash-libs.ts";
import { wiring } from "./lib/guard-wiring-fixtures.ts";
import { cleanupAll, read, realTmp, REPO, SKIP_POSIX } from "./lib/worktree-fixtures.ts";

interface Row {
  readonly command: string;
  readonly transcript: TranscriptClass;
  readonly note: string;
}

after(cleanupAll);

const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures");
const CORPUS_FILE = path.join(FIXTURES, "mempalace-transcript", "recognition-corpus.json");
const GUARD_CORPUS_FILE = path.join(FIXTURES, "worktree-guard", "recognition-corpus.json");
const CORPUS = JSON.parse(read(CORPUS_FILE)) as Row[];
const GUARD_CORPUS = JSON.parse(read(GUARD_CORPUS_FILE)) as {
  command: string;
  guard: boolean;
}[];
const CLASSES: readonly TranscriptClass[] = [
  "no",
  "direct",
  "legacy-enabled",
  "legacy-unmarked",
  "foreign-prefix",
];

/**
 * Commands that chain, substitute or redirect: never a transcript command, in
 * either twin (R24 last sentence; plan step 27). Kept here, not in the corpus,
 * because they test the boundary rather than name a class setup wrote.
 */
const NEVER: readonly string[] = [
  "bash /repo/hooks/mempalace-transcript.sh | tee /tmp/log",
  "bash /repo/hooks/mempalace-transcript.sh || true",
  "bash /repo/hooks/mempalace-transcript.sh\nrm -rf /tmp/x",
  'true && node "/x/hooks/mempalace-transcript.ts" claude-code',
  'node "/x/hooks/mempalace-transcript.ts" claude-code; echo done',
  'node "/x/hooks/mempalace-transcript.ts" claude-code &',
  "(bash /x/hooks/mempalace-transcript.sh)",
  "bash /x/hooks/mempalace-transcript.sh > /dev/null",
  "bash /x/hooks/mempalace-transcript.sh $(id)",
  'bash "$(pwd)/hooks/mempalace-transcript.sh"',
  'bash "/x/hooks/mempalace-transcript.sh" `id`',
  "MEMPALACE_TRANSCRIPT_ENABLED=$(cat /x/flag) bash /x/hooks/mempalace-transcript.sh",
  "MEMPALACE_TRANSCRIPT_ENABLED=`cat /x/flag` bash /x/hooks/mempalace-transcript.sh",
  "set NoDefaultCurrentDirectoryInExePath=1&& node C:/x/hooks/mempalace-transcript.ts claude-code && calc",
];

/** Run a jq predicate of the Bash library over `file` (a JSON array of `{command}` rows). */
function bashOver(file: string, predicate: string): string[] {
  const res = bashLibs(
    `jq -r --arg shape grouped "$_UC_JQ_DEFS .[] | {type: \\"command\\", command} | ${predicate}" ${JSON.stringify(file)}`,
  );
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.replace(/\n$/, "").split("\n");
}

function rowsFile(commands: readonly string[]): string {
  const file = path.join(realTmp("crewrig-transcript-corpus-"), "rows.json");
  fs.writeFileSync(file, JSON.stringify(commands.map((command) => ({ command }))));
  return file;
}

describe("the corpus (R24)", () => {
  test("holds every class, and only the five classes", () => {
    for (const cls of CLASSES)
      assert.ok(
        CORPUS.some((row) => row.transcript === cls),
        cls,
      );
    for (const row of CORPUS) assert.ok(CLASSES.includes(row.transcript), row.command);
    for (const row of CORPUS) assert.ok(row.note.length > 0, `${row.command} has a note`);
  });

  test("holds the four rows the predicates-agree scenario names, with their class", () => {
    const expected: Record<string, TranscriptClass> = {
      'MEMPALACE_TRANSCRIPT_ENABLED=1 bash "/x/hooks/mempalace-transcript.sh" Stop':
        "legacy-enabled",
      'node "/x/hooks/mempalace-transcript.ts" claude-code': "direct",
      'MEMPALACE_TRANSCRIPT_ENABLED=0 node "/x/hooks/mempalace-transcript.ts" claude-code':
        "foreign-prefix",
      'bash "/x/hooks/worktree-git-guard.sh"': "no",
    };
    for (const [command, cls] of Object.entries(expected)) {
      assert.equal(CORPUS.find((row) => row.command === command)?.transcript, cls, command);
    }
  });

  test("holds the delta-01 rows with other arguments, each classed no", () => {
    for (const command of [
      'bash "/x/hooks/mempalace-transcript.sh" --foo bar',
      'bash "/x/hooks/mempalace-transcript.sh" Stop extra',
      'node "/x/hooks/mempalace-transcript.ts" claude-code Stop',
    ]) {
      assert.equal(CORPUS.find((row) => row.command === command)?.transcript, "no", command);
    }
  });

  test("holds the chained command of the scenario, classed no", () => {
    const chained = "bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh";
    assert.equal(CORPUS.find((row) => row.command === chained)?.transcript, "no");
  });
});

describe("the TypeScript recogniser", () => {
  for (const row of CORPUS) {
    test(`${row.transcript}: ${JSON.stringify(row.command)} (${row.note})`, () => {
      assert.equal(classifyTranscript(row.command), row.transcript);
    });
  }

  test("a chained, substituted or redirected command is never a transcript command", () => {
    for (const command of NEVER) assert.equal(classifyTranscript(command), "no", command);
  });
});

describe("`hook-wiring.ts transcript classify`", () => {
  test("prints the corpus class of every row, one per line", () => {
    const file = path.join(realTmp("crewrig-transcript-classify-"), "commands.json");
    fs.writeFileSync(file, JSON.stringify(CORPUS.map((row) => row.command)));
    const res = wiring("transcript", "classify", "--commands", file);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(
      res.stdout.replace(/\n$/, "").split("\n"),
      CORPUS.map((row) => row.transcript),
    );
  });

  test("refuses a file that is not an array of strings, with exit 1", () => {
    const file = path.join(realTmp("crewrig-transcript-classify-"), "commands.json");
    fs.writeFileSync(file, JSON.stringify({ command: "bash /x/mempalace-transcript.sh" }));
    const res = wiring("transcript", "classify", "--commands", file);
    assert.equal(res.status, 1);
    assert.equal(res.stdout, "");
  });
});

describe("the generic render/rewrite path refuses the transcript hook (review i1-F6)", () => {
  test("it stays registered, for its manifest and label", () => {
    assert.notEqual(lookupHook("mempalace-transcript"), null);
  });

  test("`--hook mempalace-transcript render <cli>` exits 2 and points to the transcript subcommands", () => {
    const res = wiring("--hook", "mempalace-transcript", "render", "claude");
    assert.equal(res.status, 2);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /use `hook-wiring\.ts transcript render\|rewrite/);
  });

  test("`--hook mempalace-transcript rewrite <cli>` exits 2 and leaves the configuration byte-identical", () => {
    const file = path.join(realTmp("crewrig-transcript-generic-"), "settings.json");
    const before = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "bash /x/mempalace-transcript.sh" }] }],
      },
    });
    fs.writeFileSync(file, before);
    const res = wiring("--hook", "mempalace-transcript", "rewrite", "claude", "--config", file);
    assert.equal(res.status, 2);
    assert.equal(res.stdout, "");
    assert.match(res.stderr, /transcript render\|rewrite/);
    assert.equal(read(file), before);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ["settings.json"]);
  });
});

describe("the Bash twin agrees (R24)", { skip: SKIP_POSIX }, () => {
  test("sr_transcript_class returns the corpus class of every row", () => {
    const got = bashOver(CORPUS_FILE, "sr_transcript_class");
    assert.equal(got.length, CORPUS.length);
    CORPUS.forEach((row, i) => {
      assert.equal(got[i], row.transcript, `${JSON.stringify(row.command)} (${row.note})`);
    });
  });

  test("sr_transcript_class says no to every chained, substituted or redirected command", () => {
    assert.deepEqual(
      bashOver(rowsFile(NEVER), "sr_transcript_class"),
      NEVER.map(() => "no"),
    );
  });

  test("sr_is_own is exactly: an owned transcript class, or a guard command", () => {
    const own = bashOver(CORPUS_FILE, "sr_is_own");
    const guard = bashOver(CORPUS_FILE, "sr_is_guard");
    CORPUS.forEach((row, i) => {
      const expected = OWN_CLASSES.includes(row.transcript) || guard[i] === "true";
      assert.equal(own[i], String(expected), `${JSON.stringify(row.command)} (${row.note})`);
    });
  });

  test("it rejects the foreign-prefix row and accepts the direct row of the scenario", () => {
    const file = rowsFile([
      'MEMPALACE_TRANSCRIPT_ENABLED=0 node "/x/hooks/mempalace-transcript.ts" claude-code',
      'node "/x/hooks/mempalace-transcript.ts" claude-code',
      'MEMPALACE_TRANSCRIPT_ENABLED=1 bash "/x/hooks/mempalace-transcript.sh" Stop',
      'node "/x/hooks/mempalace-transcript.ts"',
    ]);
    assert.deepEqual(bashOver(file, "sr_is_own"), ["false", "true", "true", "true"]);
  });

  test("the guard half is unchanged: sr_is_guard gives C2's verdict on C2's corpus", () => {
    const got = bashOver(GUARD_CORPUS_FILE, "sr_is_guard");
    GUARD_CORPUS.forEach((row, i) => {
      assert.equal(got[i], String(row.guard), JSON.stringify(row.command));
    });
  });

  test("a guard command is owned whatever the transcript half says of it", () => {
    const own = bashOver(GUARD_CORPUS_FILE, "sr_is_own");
    const transcript = bashOver(GUARD_CORPUS_FILE, "sr_is_transcript");
    GUARD_CORPUS.forEach((row, i) => {
      assert.equal(
        own[i],
        String(row.guard || transcript[i] === "true"),
        JSON.stringify(row.command),
      );
    });
  });
});
