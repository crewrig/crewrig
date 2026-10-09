// build-components-differential-deviations.test.ts — the CLOSED list of deviations from the
// shell (spec 0250 R33 (e), (f), (g); the rest is in -deviations-diag; plan step 22): each row carries `deviation: R33(<letter>)`,
// runs the unchanged shell script and the entry over the same tree, and asserts BOTH sides'
// behaviour. Where a row builds ordinary components next to the special one, everything outside
// the special component is compared strictly (a mask removes only the special component's lines
// and paths from both sides), so an unlisted difference in the same run still fails; and the
// unmasked outcomes must differ, so a deviation that vanishes fails too. Letters (a) and (c) are
// the transforms of differential-compare.ts, exercised by the --check rows of the matrix suite.
// Linux gate or CREWRIG_SHELL_PARITY=1; retires in PR D. Harness: fixtures/build-components/.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { expectSame } from "./fixtures/build-components/differential-compare.ts";
import {
  makePair,
  normalise,
  runShell,
  runTs,
} from "./fixtures/build-components/differential-kit.ts";
import type { Outcome, Pair, Put } from "./fixtures/build-components/differential-kit.ts";
import { CONFIG, skill, source } from "./fixtures/build-components/entry-kit.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";

const SKIP = parityGate();
const TARGET = ["--target", "claude"];

/** Both outcomes of one row, normalised, plus the raw ones. */
function both(pair: Pair, args: string[], extra: Record<string, string> = {}) {
  const rawShell = runShell(pair.a, pair.tmpA, args, extra);
  const rawTs = runTs(pair.b, pair.tmpB, args, extra);
  return {
    rawShell,
    rawTs,
    shell: normalise(rawShell, [pair.a], [pair.tmpA]),
    ts: normalise(rawTs, [pair.b], [pair.tmpB]),
  };
}

/** The same outcome without the lines and tree rows of the special component. */
const masked = (o: Outcome, drop: RegExp): Outcome => ({
  ...o,
  stdout: o.stdout
    .split("\n")
    .filter((l) => !drop.test(l))
    .join("\n"),
  tree: o.tree.filter((r) => !drop.test(r)),
});
const count = (text: string, re: RegExp): number =>
  text.split("\n").filter((l) => re.test(l)).length;

describe(
  "(e) a CRLF or BOM source is read as LF where the shell found no frontmatter",
  { skip: SKIP },
  () => {
    const populate = (put: Put): void => {
      put("crewrig.config.toml", CONFIG);
      put("artifacts/core/skills/ok/SKILL.md", skill("ok"));
      put("artifacts/core/skills/crlf/SKILL.md", skill("crlf").replaceAll("\n", "\r\n"));
      put("artifacts/core/skills/bom/SKILL.md", `﻿${skill("bom")}`);
    };
    test("deviation: R33(e): the shell builds a component named null, the entry builds crlf and bom", () => {
      const { shell, ts, rawTs } = both(makePair(populate), TARGET);
      const special =
        /Building skill: (null|crlf|bom)$|skills\/(null|crlf|bom)(\/|$)|\.claude\/skills\/(null|crlf|bom)/;
      expectSame(
        "everything but the special components",
        masked(shell, special),
        masked(ts, special),
      );
      assert.equal(
        count(shell.stdout, /^Building skill: null$/),
        2,
        "the shell: both sources are `null`",
      );
      assert.deepEqual(
        shell.tree.filter((r) => /^[DF] \.claude\/skills\/(crlf|bom)/.test(r)),
        [],
      );
      assert.equal(count(ts.stdout, /^Building skill: (crlf|bom)$/), 2);
      assert.ok(ts.tree.some((r) => r.startsWith("F .claude/skills/crlf/SKILL.md ")));
      assert.ok(ts.tree.some((r) => r.startsWith("F .claude/skills/bom/SKILL.md ")));
      assert.equal(rawTs.stderr, "");
      assert.notDeepEqual(shell.tree, ts.tree);
    });
  },
);

describe(
  "(f) an absent or null name is skipped where the shell built a component named null",
  { skip: SKIP },
  () => {
    const populate = (put: Put): void => {
      put("crewrig.config.toml", CONFIG);
      put("artifacts/core/skills/ok/SKILL.md", skill("ok"));
      put("artifacts/core/skills/empty/SKILL.md", source(["name:", 'description: "d"']));
      // `Null` and `NULL` sit in tiers of their own: on a case-insensitive file system they would
      // share an output directory with `null`
      for (const [tier, dir, name] of [
        ["core", "nul", "null"],
        ["t2", "cnull", "Null"],
        ["t3", "unull", "NULL"],
        ["core", "tilde", "~"],
      ]) {
        put(
          `artifacts/${tier}/skills/${dir}/SKILL.md`,
          source([`name: ${name}`, 'description: "d"']),
        );
      }
      put("artifacts/core/skills/noname/SKILL.md", source(['description: "d"']));
      put("artifacts/library/skills/quoted/SKILL.md", source(['name: "~"', 'description: "d"']));
    };
    test("deviation: R33(f): five spellings skipped by the entry; the empty name, a quoted ~ and the rest equal", () => {
      const { shell, ts } = both(makePair(populate), TARGET);
      const special =
        /^Building skill: (null|Null|NULL|~)$|^Warning: .*\/(nul|cnull|unull|tilde|noname)\/\/SKILL\.md|^  Generated: <ROOT>\/(dist\/t[23]\/)?\.claude\/skills\/(null|Null|NULL|~)\/|^[DF] (dist\/t[23]\/)?\.claude\/skills\/(null|Null|NULL|~)(\/|$| )|^D dist\/t[23](\/|$)/;
      expectSame("everything but the null spellings", masked(shell, special), masked(ts, special));
      assert.equal(
        count(shell.stdout, /^Building skill: (null|~|Null|NULL)$/),
        6,
        "the shell built a component for each spelling and the quoted ~",
      );
      assert.equal(
        count(
          ts.stdout,
          /^Warning: .*\/(nul|cnull|unull|tilde|noname)\/\/SKILL\.md missing 'name' field, skipping$/,
        ),
        5,
      );
      assert.equal(
        count(ts.stdout, /^Building skill: (null|~|Null|NULL)$/),
        1,
        "only the quoted ~ of the library tier is built",
      );
      assert.ok(ts.tree.some((r) => r.startsWith("F dist/library/.claude/skills/~/SKILL.md ")));
      assert.ok(shell.tree.some((r) => r.startsWith("F .claude/skills/null/SKILL.md ")));
      assert.ok(!ts.tree.some((r) => r.startsWith("F .claude/skills/null/")));
    });
  },
);

describe(
  "(g) a provenance entry that is a mapping or a sequence is an error where the shell wrote an empty block",
  { skip: SKIP },
  () => {
    for (const [shape, key] of [
      ["    nested:\n      a: 1", "nested"],
      ["    list:\n      - a", "list"],
    ] as const) {
      test(`deviation: R33(g): ${key}`, () => {
        const pair = makePair((put) => {
          put("crewrig.config.toml", CONFIG);
          put(
            "artifacts/core/skills/bad/SKILL.md",
            `---\nname: bad\ndescription: d\nmetadata:\n  provenance:\n    version: 1\n${shape}\n---\nB\n`,
          );
        });
        const { shell, ts } = both(pair, TARGET);
        assert.equal(shell.status, 0);
        assert.match(
          fs.readFileSync(path.join(pair.a, ".claude/skills/bad/SKILL.md"), "utf8"),
          /metadata:\n {2}provenance:\n---\n/,
          "the shell's empty block",
        );
        assert.equal(ts.status, 1);
        assert.match(
          ts.stderr,
          new RegExp(
            `^Error: <ROOT>/artifacts/core/skills/bad//SKILL\\.md: metadata\\.provenance\\.${key} is a mapping or a sequence; `,
          ),
        );
        assert.equal(fs.existsSync(path.join(pair.b, ".claude")), false);
      });
    }
  },
);
