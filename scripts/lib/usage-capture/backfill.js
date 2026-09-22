// backfill.js — the Node-side driver for scripts/usage-backfill.sh (spec
// 0206 PLAN v3 step 16). Reuses the step 5-7 adapters (claude-code.js,
// gemini-cli.js, copilot-cli.js) UNCHANGED and the same per-source cursors
// the live hook path advances, so a re-run against unchanged history adds
// nothing beyond what an earlier run already produced (R23 idempotence —
// the CLIs' own byteOffset/maxRowId tracking is what makes this true, not a
// separate backfill-only ledger).
//
// Antigravity CLI is NOT covered (R23): its capture channel exposes no
// durable history to replay. This file touches none of the four
// scripts/import-*-history.sh scripts, their sources, targets or state
// (R24) — it reads only ~/.claude/projects/, ~/.gemini/tmp/ and
// ~/.copilot/session-store.db, and writes only through sink.js.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { submit } = require('./index');
const claudeCode = require('./adapters/claude-code');
const geminiCli = require('./adapters/gemini-cli');
const copilotCli = require('./adapters/copilot-cli');

// historicalCtx() — spec 0208: declarations: false and cwd: null together
// make every one of the four attribution channels structurally absent
// (attribution.js), because the checkout state read today does not
// correspond to the branch checked out when a historical request ran
// (rejected alternative, PLAN v3). Every backfilled record resolves
// unattributed; the ledger is the designed correction instrument.
function historicalCtx() {
  return { now: Date.now(), env: {}, cwd: null, declarations: false, memo: new Map() };
}

function walk(dir, predicate, results) {
  results = results || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, results);
    } else if (predicate(entry.name, full)) {
      results.push(full);
    }
  }
  return results;
}

// emptyCounts() / submitAll() — a `rejected` outcome is a SKIP, never a
// throw (spec 0207 review hand-over, DEV follow-up issue #1169): a period
// the 0207 storage has already pruned is expected to come back rejected on
// every subsequent backfill over that period, and silently dropping the
// count would make that backfill look short with no visible reason. Every
// outcome sink.submit() can return is tallied: `stored` and `duplicate` as
// plain counters, `rejected` broken down BY REASON so "3 rejected" is never
// the whole story.
function emptyCounts() {
  return { stored: 0, duplicate: 0, rejected: {} };
}

function submitAll(records, counts, ctx) {
  for (const rec of records) {
    const result = submit(rec, ctx);
    if (result.status === 'stored') {
      counts.stored += 1;
    } else if (result.status === 'duplicate') {
      counts.duplicate += 1;
    } else if (result.status === 'rejected') {
      const reason = result.reason || 'unknown';
      counts.rejected[reason] = (counts.rejected[reason] || 0) + 1;
    }
  }
}

function backfillClaudeCode(ctx) {
  const counts = emptyCounts();
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) return { ...counts, sources: 0 };
  // Main session files only. claude-code.js's own capture() auto-discovers
  // each session's sibling <session>/subagents/ directory, so a subagent
  // file must NOT also be enumerated here — that would double-derive it
  // under two different top-level `transcriptPath` calls.
  const sep = path.sep;
  const sessionFiles = walk(root, (name, full) => name.endsWith('.jsonl') && !full.includes(`${sep}subagents${sep}`));
  for (const file of sessionFiles) {
    submitAll(claudeCode.capture({ transcriptPath: file, cwd: null }), counts, ctx);
  }
  return { ...counts, sources: sessionFiles.length };
}

function backfillGeminiCli(ctx) {
  const counts = emptyCounts();
  const root = path.join(os.homedir(), '.gemini', 'tmp');
  if (!fs.existsSync(root)) return { ...counts, sources: 0 };
  // Top-level session files directly under each project's own chats/
  // directory only. A subagent transcript lives one directory deeper
  // (chats/<parentSessionId>/<sub>.jsonl) and gemini-cli.js's own capture()
  // discovers those from the parent transcript path — enumerating them here
  // too would double-derive them.
  const sessionFiles = walk(root, (name, full) => {
    if (!(name.endsWith('.jsonl') || name.endsWith('.json'))) return false;
    const rel = path.relative(root, full);
    const parts = rel.split(path.sep);
    return parts.length === 3 && parts[1] === 'chats';
  });
  for (const file of sessionFiles) {
    submitAll(geminiCli.capture({ transcriptPath: file, cwd: null }), counts, ctx);
  }
  return { ...counts, sources: sessionFiles.length };
}

function backfillCopilotCli(ctx) {
  const counts = emptyCounts();
  const storePath = path.join(os.homedir(), '.copilot', 'session-store.db');
  if (!fs.existsSync(storePath)) return { ...counts, sources: 0 };
  submitAll(copilotCli.capture({ storePath }), counts, ctx);
  return { ...counts, sources: 1 };
}

function usageRoot() {
  return process.env.CREWRIG_USAGE_ROOT || path.join(os.homedir(), '.crewrig', 'usage');
}

function resetCursors() {
  const stateDir = path.join(usageRoot(), 'state');
  for (const cli of ['claude-code', 'gemini-cli', 'copilot-cli']) {
    fs.rmSync(path.join(stateDir, cli), { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--reset-cursors')) {
    resetCursors();
  }

  const ctx = historicalCtx();
  const results = {
    'claude-code': backfillClaudeCode(ctx),
    'gemini-cli': backfillGeminiCli(ctx),
    'copilot-cli': backfillCopilotCli(ctx),
  };

  for (const [cli, r] of Object.entries(results)) {
    const rejectedTotal = Object.values(r.rejected).reduce((a, b) => a + b, 0);
    const rejectedBreakdown =
      rejectedTotal > 0
        ? ` (${Object.entries(r.rejected)
            .map(([reason, count]) => `${reason}: ${count}`)
            .join(', ')})`
        : '';
    console.log(
      `${cli}: ${r.stored} stored, ${r.duplicate} duplicate, ${rejectedTotal} rejected${rejectedBreakdown} — from ${r.sources} source(s)`
    );
  }
}

main();
