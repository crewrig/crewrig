#!/usr/bin/env node
// usage-capture-derive.js — companion Node driver for
// scripts/tests/test-usage-capture.sh (PLAN v3 step 19). All pass/fail
// accounting stays in the bash suite, matching test-usage-record-schema.sh's
// own convention; this script's only job is to call the real adapters
// against a fixture and print a machine-parseable result the bash suite can
// assert on and hand to scripts/lib/usage-record-validator.js.
//
// Usage:
//   node usage-capture-derive.js <mode> [args...] --out <dir>
//
// Every mode writes each derived record to <dir>/rec-<n>.json and prints one
// line to stdout:
//   RESULT captured=<n> uncaptured=<n> total=<n>
// followed by one line per record:
//   RECORD <index> <kind> <file>
// A fatal usage/setup error prints "FATAL: <message>" to stderr and exits 2.
//
// --submit additionally hands every derived record through sink.js (the same
// path scripts/lib/usage-capture/backfill.js's own submitAll() uses), and
// prints:
//   SUBMIT stored=<n> duplicate=<n> rejected=<n>
// This is the mechanism-agnostic way to observe R23 idempotence: a
// cursor-tracked source (claude-code, gemini-cli's jsonl generations,
// copilot-cli) suppresses re-derivation at the ADAPTER, so a second pass
// derives zero records and therefore stores zero; a source with no cursor
// (gemini-cli's whole-JSON legacy-json / json-kind-summary generations —
// the file is rewritten wholesale, not appended to, so there is no byte
// offset to track) re-derives the SAME records every pass, and it is the
// SINK's own recordId-based atomic-link dedup (spool.js, EEXIST -> the
// PATCH's `duplicate` status) that keeps a second pass from storing anything
// new. Both are legitimate implementations of "a re-run adds nothing" — the
// only assertion that holds across both is stored==0 on the second pass.

'use strict';

const fs = require('fs');
const path = require('path');

const MODULE_ROOT = path.join(__dirname, '..', '..', 'lib', 'usage-capture');

// SAFETY (incident, this session): record.cliVersionFor() shells a memoized
// `<bin> --version` for gemini-cli/copilot-cli/headless-envelope, resolved
// via `command -v -- <bin>` against $PATH — NOT gated by --home. On a
// developer machine with the real CLIs installed, a fixture derivation that
// set only $HOME still let the real binary run under that $HOME, and a real
// `copilot` binary wrote ~136 MiB of its own cache tree directly into a
// git-tracked fixture directory before this guard existed. $PATH is pinned
// here, unconditionally, before any adapter capture() runs, so
// resolveBinaryPath() can never find a real claude/gemini/copilot/agy
// binary regardless of which mode or fixture is being driven.
process.env.PATH = '/usr/bin:/bin';

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      opts[key] = argv[i + 1];
      i += 1;
    } else {
      positional.push(a);
    }
  }
  return { positional, opts };
}

function writeRecords(records, outDir, submit) {
  fs.mkdirSync(outDir, { recursive: true });
  let captured = 0;
  let uncaptured = 0;
  const lines = [];
  records.forEach((rec, i) => {
    const file = path.join(outDir, `rec-${i}.json`);
    fs.writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
    if (rec.kind === 'captured') captured += 1;
    else uncaptured += 1;
    lines.push(`RECORD ${i} ${rec.kind} ${file}`);
  });
  console.log(`RESULT captured=${captured} uncaptured=${uncaptured} total=${records.length}`);
  for (const line of lines) console.log(line);

  if (submit) {
    const sink = require(path.join(MODULE_ROOT, 'sink'));
    let stored = 0;
    let duplicate = 0;
    let rejected = 0;
    for (const rec of records) {
      const result = sink.submit(rec);
      if (result.status === 'stored') stored += 1;
      else if (result.status === 'duplicate') duplicate += 1;
      else rejected += 1;
    }
    console.log(`SUBMIT stored=${stored} duplicate=${duplicate} rejected=${rejected}`);
  }
}

function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const mode = positional[0];
  const outDir = opts.out;
  if (mode !== 'assert-shape-rejects' && !outDir) {
    console.error('FATAL: --out <dir> is required');
    process.exit(2);
  }

  let records;

  switch (mode) {
    case 'claude-code': {
      const claudeCode = require(path.join(MODULE_ROOT, 'adapters', 'claude-code'));
      records = claudeCode.capture({ transcriptPath: positional[1], cwd: opts.cwd || null });
      break;
    }
    case 'gemini-cli': {
      const geminiCli = require(path.join(MODULE_ROOT, 'adapters', 'gemini-cli'));
      records = geminiCli.capture({ transcriptPath: positional[1], cwd: opts.cwd || null });
      break;
    }
    case 'copilot-cli': {
      const copilotCli = require(path.join(MODULE_ROOT, 'adapters', 'copilot-cli'));
      const priorHome = process.env.HOME;
      if (opts.home) process.env.HOME = opts.home;
      try {
        records = copilotCli.capture({ storePath: positional[1] });
      } finally {
        if (opts.home) process.env.HOME = priorHome;
      }
      break;
    }
    case 'antigravity': {
      const antigravity = require(path.join(MODULE_ROOT, 'adapters', 'antigravity'));
      const payload = JSON.parse(fs.readFileSync(positional[1], 'utf8'));
      records = antigravity.capture({ payload });
      break;
    }
    case 'headless': {
      const headlessEnvelope = require(path.join(MODULE_ROOT, 'adapters', 'headless-envelope'));
      const cli = positional[1];
      const envelope = JSON.parse(fs.readFileSync(positional[2], 'utf8'));
      const rec = headlessEnvelope.capture({
        cli,
        envelope,
        launchInstant: opts['launch-instant'] || null,
        projectRoot: opts['project-root'] || null,
      });
      records = [rec];
      break;
    }
    case 'assert-shape-rejects': {
      const record = require(path.join(MODULE_ROOT, 'record'));
      const dirs = positional.slice(1);
      let failures = 0;
      for (const dir of dirs) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
        if (files.length === 0) {
          console.error(`FATAL: ${dir} has zero .json files — refusing to pass vacuously`);
          process.exit(2);
        }
        for (const f of files) {
          const full = path.join(dir, f);
          const rec = JSON.parse(fs.readFileSync(full, 'utf8'));
          const shape = record.assertRecordShape(rec);
          if (shape.ok) {
            console.log(`FAIL ${full}: assertRecordShape() accepted a mutant/derivation fixture it must reject`);
            failures += 1;
          } else {
            console.log(`OK ${full}: rejected (${shape.reason})`);
          }
        }
      }
      console.log(`RESULT rejects=${failures === 0 ? 'all' : 'not-all'} failures=${failures}`);
      process.exit(failures === 0 ? 0 : 1);
    }
    default:
      console.error(`FATAL: unrecognized mode: ${mode}`);
      process.exit(2);
  }

  writeRecords(records, outDir, Boolean(opts.submit));
}

main();
