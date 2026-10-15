// extension-hooks-differential.test.ts — the oracle and the differential of the example hooks
// (spec 0258 R16, R20, R28, R29). A corpus of standard-input payloads runs against the shell twin
// (Linux only, `LC_ALL=C bash`) and the TypeScript entry (plain `node`); standard output, standard
// error and exit status are compared, standard error is empty everywhere, and the shell's output is
// the committed `.golden` fixture. A deviation-tagged case compares the entry with its overlay.
//
// Once the switch deleted the `.sh` files the shell leg is skipped with an explicit reason and the
// entry is judged against the stored goldens; the goldens are never edited by hand.
// Regenerate the goldens (needs the shell twins) inside the Linux container: CREWRIG_REGEN_GOLDENS=1 node --test <this file>.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CASES,
  DEVIATIONS,
  HOOKS,
  goldenForm,
  onLinux,
  readGolden,
  runEntry,
  runShell,
  shellLegSkip,
  SHELL_RETIRED,
  hasShellTwin,
  writeGolden,
  type Case,
  type Feed,
  type Result,
} from "./lib/extension-hooks-harness.ts";

const REGEN = process.env["CREWRIG_REGEN_GOLDENS"] === "1";
const piped = (item: Case): Feed => ({ kind: "pipe", data: item.input });
const bytes = (text: string): Buffer => Buffer.from(text);

/** A result that must be silent: status 0, nothing on standard error (R20). */
function assertSilent(result: Result, label: string): void {
  assert.equal(result.stderr.toString(), "", `${label}: standard error`);
  assert.equal(result.status, 0, `${label}: exit status`);
}

describe("regeneration", { skip: !REGEN }, () => {
  test(
    "the goldens are the shell output, identical for the three shell twins",
    {
      skip: HOOKS.some((hook) => !hasShellTwin(hook)) ? SHELL_RETIRED : !onLinux,
    },
    () => {
      for (const item of CASES) {
        const outputs = HOOKS.map((hook) => runShell(hook, piped(item)));
        for (const out of outputs) assertSilent(out, item.name);
        for (const out of outputs) assert.deepEqual(out.stdout, outputs[0]?.stdout, item.name);
        writeGolden(item, outputs[0]?.stdout ?? Buffer.alloc(0));
      }
    },
  );
});

for (const hook of HOOKS) {
  describe(`${hook}: corpus`, () => {
    for (const item of CASES) {
      const tag = DEVIATIONS[item.name];

      test(`${item.name}: the entry writes the expected line and nothing else`, () => {
        const entry = runEntry(hook, piped(item));
        assertSilent(entry, item.name);
        // Overlay for a deviation case, else the shell's recorded result.
        const expected = tag ? goldenForm(item, tag.entry) : readGolden(item);
        assert.deepEqual(goldenForm(item, entry.stdout), expected);
      });

      test(
        `${item.name}: the shell twin matches its golden, and the entry matches the shell`,
        {
          skip: shellLegSkip(hook),
        },
        () => {
          const shell = runShell(hook, piped(item));
          assertSilent(shell, item.name);
          assert.deepEqual(goldenForm(item, shell.stdout), readGolden(item));
          const entry = runEntry(hook, piped(item));
          if (tag) {
            // Tagged deviation: the entry is held to the overlay, never to the shell.
            assert.deepEqual(entry.stdout, tag.entry, `deviation (${tag.letter})`);
          } else {
            assert.deepEqual(entry.stdout, shell.stdout);
            assert.deepEqual(entry.stderr, shell.stderr);
            assert.equal(entry.status, shell.status);
          }
        },
      );
    }
  });

  describe(`${hook}: broken standard input (R20)`, () => {
    const feeds: readonly [string, Feed, string][] = [
      ["closed (<&-)", { kind: "closed" }, "\n"],
      ["non-blocking pipe, no data (EAGAIN)", { kind: "eagain", data: Buffer.alloc(0) }, "\n"],
      [
        "non-blocking pipe, a partial line then EAGAIN",
        { kind: "eagain", data: bytes('  {"a":1} ') },
        '{"a":1}\n',
      ],
      [
        "non-blocking pipe, a full line",
        { kind: "eagain", data: bytes('{"a":1}\nignored\n') },
        '{"a":1}\n',
      ],
    ];
    for (const [label, feed, expected] of feeds) {
      test(`${label}: the entry writes what it has, exit 0, standard error empty`, () => {
        const entry = runEntry(hook, feed);
        assertSilent(entry, label);
        assert.equal(entry.stdout.toString(), expected);
      });
    }

    // PENDING DEVIATION (letter reserved for a delta of spec 0258, found by this differential): on a
    // closed or non-blocking input bash's `read` reports its failure on standard error
    // (`read: read error: 0: ...`) and still echoes one line feed, exit 0; the entry stays silent
    // (R20). Standard output and exit status must still agree.
    const SHELL_NOISE = [
      ["closed standard input", { kind: "closed" }, "Bad file descriptor"],
      [
        "EAGAIN on a non-blocking pipe",
        { kind: "eagain", data: Buffer.alloc(0) },
        "Resource temporarily unavailable",
      ],
    ] as const;
    for (const [label, feed, message] of SHELL_NOISE) {
      test(
        `${label}: the shell twin reports on standard error, the entry does not`,
        {
          skip: shellLegSkip(hook),
        },
        () => {
          const shell = runShell(hook, feed);
          const entry = runEntry(hook, feed);
          assert.equal(shell.status, 0);
          assert.match(
            shell.stderr.toString(),
            new RegExp(`^.*: line \\d+: read: read error: 0: ${message}\\n$`),
          );
          assertSilent(entry, label);
          assert.deepEqual(entry.stdout, shell.stdout);
        },
      );
    }

    // PENDING DEVIATION, second finding: a partial line followed by EAGAIN is dropped by bash's
    // `read` (one line feed is echoed), while the entry keeps what it received.
    test(
      "a partial line then EAGAIN: the shell twin drops it, the entry keeps it",
      {
        skip: shellLegSkip(hook),
      },
      () => {
        const feed: Feed = { kind: "eagain", data: bytes('  {"a":1} ') };
        const shell = runShell(hook, feed);
        assert.equal(shell.stdout.toString(), "\n");
        assert.equal(runEntry(hook, feed).stdout.toString(), '{"a":1}\n');
      },
    );
  });
}
