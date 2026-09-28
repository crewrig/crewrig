// usage-inventory.test.ts — the fake-daemon suite for the MemPalace
// usage-record drawer inventory and purge command (spec 0239, issue #1206;
// PLAN v1 step 8, extended per PLAN review finding v1-F1; TypeScript port of
// the twice-reviewed test-usage-storage-inventory.sh, PR #1361, forced by
// spec 0238's shell/JS ratchet — see scripts/lib/usage-store/inventory.ts's
// own header for the full rationale). Named after the file under test
// (scripts/usage-inventory.ts), matching this repository's own *.test.ts
// convention (scripts/tests/check-ratchet.test.ts names check-ratchet.ts,
// not "test-check-ratchet.test.ts").
//
// The ONLY daemon this suite ever talks to is
// scripts/tests/fixtures/usage-storage/fake-mempalace-inventory-mcp.ts,
// bound to a caller-picked ephemeral port — never the real daemon at
// 127.0.0.1:41893. This suite is DEDICATED to
// scripts/lib/usage-store/inventory.ts's four tools (mempalace_list_wings,
// mempalace_list_drawers, mempalace_get_drawer, mempalace_delete_drawer) and
// does not extend fake-mempalace-mcp.js, which is scoped to mirror.js's own
// two tools (see that fixture's own header comment) — the same reasoning
// extends to this suite: a dedicated fixture and a dedicated suite, never
// entangled with test-usage-storage-mirror.sh's own fault-injection surface.
//
// Deliberately does NOT create CREWRIG_USAGE_ROOT at all: spec 0239 R1
// requires this command to produce a complete inventory when the local usage
// root, its journal, and its mirror markers under it are all absent, so this
// suite points CREWRIG_USAGE_ROOT at a path it never creates (mirrors the
// bash suite's own `mktemp -u` idiom: a name is generated, nothing is ever
// written to disk for it). Every drawer this suite works with is seeded
// DIRECTLY into the fixture's own store via its /control endpoint, never
// through mempalace_add_drawer or a local journal write — inventory.ts's
// whole premise is that it never needs either.
//
// Unlike the check-ratchet.test.ts precedent, this suite spawns the real CLI
// entry point (scripts/usage-inventory.ts) as a black box rather than
// re-importing scripts/lib/usage-store/inventory.ts's internal functions —
// preserving the exact end-to-end testing style the bash suite it replaces
// already used (spawn the command, read its stdout/exit status).
//
// No ajv/node_modules preflight (unlike test-usage-storage-mirror.sh):
// inventory.ts never runs the vendored validator or journal.js's write() path
// — confirmation is the narrow schemaVersion/provenance.cli check spec 0239
// R2 itself names, not full schema validation (see inventory.ts's own header
// comment and PLAN v1's "Alternatives considered and rejected").
//
// No mutation-discipline cases: unlike test-usage-storage-mirror.sh, this
// suite makes no in-place edits to tracked source files.
//
// Covers, at minimum, spec 0239's ten named scenarios. Nine are asserted
// directly below (a-i); the tenth — "The closing check confirms against
// MemPalace itself" (docs/usage-organization.md's usage_mirror_gate third
// check) — is a KNOWN, STATED GAP in this suite (PLAN review finding v1-F1,
// recorded as non-blocking): that check is a bash function embedded in a
// Markdown code block with zero existing automated coverage in this
// repository today, and extracting and driving a doc-embedded bash function
// is a materially different testing problem than exercising this ticket's
// own script directly. Not fixed here; stated, per this repository's own
// convention of naming known gaps rather than leaving them implicit.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { tokenPath as mcpTokenPath } from "../lib/usage-store/mcp.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(REPO, "scripts", "usage-inventory.ts");
const FIXTURE = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "usage-storage",
  "fake-mempalace-inventory-mcp.ts",
);

interface Run {
  ec: number;
  out: string;
  err: string;
}

interface SelectedDrawer {
  drawerId: string;
  wing: string;
  cli: string;
  period: string;
  recordId: unknown;
}

interface InventoryJson {
  outcome: string;
  scope?: string;
  wingsSwept?: string[];
  filters?: { cli: string | null; period: string | null };
  confirmedTotal?: number;
  excludedTotal?: number;
  excluded?: unknown[];
  selected?: SelectedDrawer[];
  selectedTotal?: number;
  byWing?: Record<string, number>;
  byCli?: Record<string, number>;
  byPeriod?: Record<string, number>;
  requiredConfirmCount?: number;
  reason?: string;
  deletedCount?: number;
  deletedDrawerIds?: string[];
  failedDrawerId?: string;
  kind?: string;
  message?: string | null;
}

function parseOut(run: Run): InventoryJson {
  return JSON.parse(run.out) as InventoryJson;
}

/** An unused ephemeral port — never 41893, the real daemon's port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : null;
      srv.close(() => {
        if (port === null) reject(new Error("could not allocate an ephemeral port"));
        else resolve(port);
      });
    });
  });
}

/** A name `mktemp -u` would generate: never created, mirroring the bash suite's own idiom for USAGE_ROOT. */
function untouchedTempPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${process.pid}-${randomInt(1_000_000_000)}`);
}

let FAKE_PORT: number;
let FAKE_TOKEN: string;
let USAGE_ROOT: string;
let PALACE_PARENT: string;
let TOKEN_PATH: string;
let fakeProc: ReturnType<typeof spawn> | undefined;
const homeDirsToClean: string[] = [];
const tempDirsToClean: string[] = [];

async function startFake(): Promise<void> {
  fakeProc = spawn(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", FIXTURE, String(FAKE_PORT), FAKE_TOKEN],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${FAKE_PORT}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      throw new Error(`fake-mempalace-inventory-mcp.ts failed to bind port ${FAKE_PORT} within 5s`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function stopFake(): void {
  if (fakeProc && fakeProc.exitCode === null && !fakeProc.killed) {
    fakeProc.kill();
  }
}

async function fakeControl<T>(body: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${FAKE_PORT}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

async function resetFake(): Promise<void> {
  await fakeControl({ reset: true });
}

/** A minimal, schema-conforming `uncaptured` usage record (block B of schemas/usage-record/v1.schema.json): only schemaVersion, provenance.cli, and timing.requestInstant are load-bearing for inventory.ts's own confirmation (R2). */
function makeContent(cli: string, requestInstant: string, recordId: string): string {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    kind: "uncaptured",
    fidelity: "per-request",
    recordId,
    idempotencyKey: `test-idem-${recordId.slice(0, 8)}`,
    provenance: {
      cli,
      cliVersion: "1.0.0",
      captureChannel: "test-fixture",
      formatFingerprint: `sha256:${"0".repeat(32)}`,
    },
    identity: {
      sessionId: `test-session-${recordId.slice(0, 8)}`,
      projectRoot: "/tmp/test-project",
    },
    timing: { requestInstant, captureInstant: requestInstant },
    uncapturedReason: "test-fixture seeded record",
  });
}

function newRecordId(): string {
  return randomBytes(32).toString("hex");
}

async function seedDrawer(wing: string, content: string, explicitId?: string): Promise<string> {
  const seed: Record<string, unknown> = { wing, content };
  if (explicitId) seed.drawerId = explicitId;
  const res = await fakeControl<{ ok: boolean; drawerId: string }>({ seedDrawer: seed });
  return res.drawerId;
}

async function countDrawers(wing: string): Promise<number> {
  const res = await fakeControl<{ ok: boolean; count: number; drawerIds: string[] }>({
    countDrawers: { wing },
  });
  return res.count;
}

async function drawerIdsFor(wing: string): Promise<string[]> {
  const res = await fakeControl<{ ok: boolean; count: number; drawerIds: string[] }>({
    countDrawers: { wing },
  });
  return res.drawerIds;
}

async function toolFailure(
  tool: string,
  shape: string | null,
  code: number | null = null,
): Promise<void> {
  await fakeControl({ toolFailure: { tool, shape, code } });
}

async function setLatency(tool: string, ms: number): Promise<void> {
  await fakeControl({ latency: { tool, ms } });
}

/** Runs the CLI under test; never trips this suite's own control flow on a non-zero exit — that is the CLI's own outcome to report. */
function runInventory(args: string[], extraEnv: Record<string, string> = {}): Run {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CREWRIG_USAGE_ROOT: USAGE_ROOT,
    MEMPALACE_PALACE_PATH: process.env.MEMPALACE_PALACE_PATH,
    MEMPALACE_MCP_PORT: String(FAKE_PORT),
    ...extraEnv,
  };
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, ...args],
    {
      encoding: "utf8",
      env,
    },
  );
  return { ec: res.status ?? 1, out: res.stdout ?? "", err: res.stderr ?? "" };
}

describe("spec 0239 usage-storage inventory suite (issue #1206)", () => {
  before(async () => {
    PALACE_PARENT = fs.mkdtempSync(path.join(os.tmpdir(), "usage-inventory-test-palace-"));
    tempDirsToClean.push(PALACE_PARENT);
    USAGE_ROOT = path.join(
      untouchedTempPath("usage-inventory-test-root"),
      "nonexistent-usage-root",
    );
    process.env.MEMPALACE_PALACE_PATH = path.join(PALACE_PARENT, "palace");

    FAKE_PORT = await freePort();
    if (FAKE_PORT === 41893) {
      throw new Error(
        "the OS handed back the real daemon's port (41893) for the fake — refusing to proceed.",
      );
    }
    FAKE_TOKEN = `fake-mempalace-inventory-token-${process.pid}-${randomInt(1_000_000_000)}`;

    // tokenPath() is hardcoded to $HOME/.mempalace/server/<hash>/token by
    // both mcp.js and common.sh — there is no override, and this suite must
    // not override HOME itself. Any such directory this suite creates under
    // the REAL $HOME is registered here and removed in the after() hook.
    TOKEN_PATH = mcpTokenPath();
    const tokenDir = path.dirname(TOKEN_PATH);
    if (fs.existsSync(tokenDir)) {
      throw new Error(
        `${tokenDir} already exists — refusing to touch pre-existing state under $HOME/.mempalace/.`,
      );
    }
    homeDirsToClean.push(tokenDir);
    fs.mkdirSync(tokenDir, { recursive: true });
    fs.writeFileSync(TOKEN_PATH, FAKE_TOKEN);

    await startFake();
  });

  after(() => {
    stopFake();
    for (const d of homeDirsToClean) fs.rmSync(d, { recursive: true, force: true });
    for (const d of tempDirsToClean) fs.rmSync(d, { recursive: true, force: true });
  });

  test("(a) a drawer orphaned by a lost journal entry is found and confirmed from its own content alone", async () => {
    await resetFake();
    assert.equal(
      fs.existsSync(USAGE_ROOT),
      false,
      "setup: the local usage root genuinely does not exist",
    );

    const orphanRid = newRecordId();
    const orphanContent = makeContent("claude-code", "2026-03-15T10:00:00.000Z", orphanRid);
    const orphanDrawerId = await seedDrawer("wing-a", orphanContent);

    const run = runInventory(["--wing", "wing-a", "--json"]);
    assert.equal(
      run.ec,
      0,
      `inventory exits 0 with no local usage root, journal, or mirror markers present\n${run.err}`,
    );
    const parsed = parseOut(run);
    assert.equal(parsed.outcome, "inventory");
    assert.equal(parsed.confirmedTotal, 1, "exactly 1 confirmed drawer (the orphan)");
    assert.equal(
      parsed.selected?.[0]?.drawerId,
      orphanDrawerId,
      "the orphaned drawer is identified solely by its own MemPalace drawer id",
    );
  });

  test("(b) an unrecognized room member is excluded from every count/listing and is never deleted", async () => {
    await resetFake();
    const goodRid = newRecordId();
    const goodContent = makeContent("gemini-cli", "2026-04-01T00:00:00.000Z", goodRid);
    await seedDrawer("wing-b", goodContent);
    const badId = await seedDrawer("wing-b", "not json at all, and no schemaVersion either");

    const run = runInventory(["--wing", "wing-b", "--json"]);
    const parsed = parseOut(run);
    assert.equal(run.ec, 0);
    assert.equal(
      parsed.confirmedTotal,
      1,
      "the unrecognized member is excluded from the count (confirmed=1)",
    );
    assert.equal(
      parsed.excludedTotal,
      1,
      "the unrecognized member is excluded from the count (excluded=1)",
    );

    const del = runInventory(["delete", "--wing", "wing-b", "--commit", "--json"]);
    assert.equal(
      del.ec,
      0,
      `the delete run (only the recognized drawer selected) succeeds\n${del.err}`,
    );
    assert.equal(
      await countDrawers("wing-b"),
      1,
      "exactly 1 drawer remains in wing-b — the unrecognized one, never deleted",
    );
    assert.ok(
      (await drawerIdsFor("wing-b")).includes(badId),
      "the surviving drawer is the unrecognized one, by id",
    );
  });

  test("(c) dry run is the default: reports what would delete, deletes nothing", async () => {
    await resetFake();
    const dryRid = newRecordId();
    await seedDrawer("wing-c", makeContent("claude-code", "2026-05-01T00:00:00.000Z", dryRid));

    const run = runInventory(["delete", "--wing", "wing-c", "--json"]);
    const parsed = parseOut(run);
    assert.equal(run.ec, 0, run.err);
    assert.equal(
      parsed.outcome,
      "dry-run",
      "a delete run without --commit reports outcome=dry-run and exits 0",
    );
    assert.equal(parsed.selectedTotal, 1, "the dry run reports exactly 1 drawer it would delete");
    assert.equal(
      await countDrawers("wing-c"),
      1,
      "the drawer is still present in MemPalace after the dry run",
    );
  });

  test("(d) a wide deletion requires an added confirmation beyond --commit", async () => {
    await resetFake();
    for (let i = 1; i <= 3; i += 1) {
      await seedDrawer(
        "wing-d",
        makeContent("claude-code", `2026-06-0${i}T00:00:00.000Z`, newRecordId()),
      );
    }

    const wideEnv = { CREWRIG_USAGE_INVENTORY_WIDE_DELETE_THRESHOLD: "2" };
    const refused = runInventory(["delete", "--wing", "wing-d", "--commit", "--json"], wideEnv);
    const refusedParsed = parseOut(refused);
    assert.notEqual(refused.ec, 0);
    assert.equal(
      refusedParsed.outcome,
      "confirmation-required",
      "3 confirmed drawers over a threshold of 2 refuses without --confirm-count",
    );
    assert.equal(
      await countDrawers("wing-d"),
      3,
      "nothing was deleted by the refused wide-deletion attempt",
    );

    const requiredCount = refusedParsed.requiredConfirmCount;
    assert.equal(typeof requiredCount, "number");
    const confirmed = runInventory(
      [
        "delete",
        "--wing",
        "wing-d",
        "--commit",
        "--confirm-count",
        String(requiredCount),
        "--json",
      ],
      wideEnv,
    );
    const confirmedParsed = parseOut(confirmed);
    assert.equal(
      confirmed.ec,
      0,
      "supplying the exact --confirm-count reported allows the wide deletion to proceed",
    );
    assert.equal(confirmedParsed.outcome, "deleted");
    assert.equal(
      await countDrawers("wing-d"),
      0,
      "all 3 drawers are deleted once the added confirmation matches",
    );
  });

  test("(e) MemPalace unreachable: fail-closed, unconfirmed, deletes nothing", async () => {
    await resetFake();
    await seedDrawer(
      "wing-e",
      makeContent("claude-code", "2026-07-01T00:00:00.000Z", newRecordId()),
    );

    // transport-500 simulates an unreachable daemon WITHOUT stopping this
    // process, so the fixture's in-memory store (and the seeded drawer)
    // survives the simulated outage.
    await toolFailure("mempalace_list_drawers", "transport-500");

    const listRun = runInventory(["--wing", "wing-e", "--json"]);
    const listParsed = parseOut(listRun);
    assert.notEqual(listRun.ec, 0);
    assert.equal(
      listParsed.outcome,
      "unconfirmed",
      "inventory reports outcome=unconfirmed and exits non-zero when MemPalace is unreachable",
    );

    const delRun = runInventory(["delete", "--wing", "wing-e", "--commit", "--json"]);
    const delParsed = parseOut(delRun);
    assert.notEqual(delRun.ec, 0);
    assert.equal(
      delParsed.outcome,
      "unconfirmed",
      "a --commit delete run also reports unconfirmed when MemPalace is unreachable",
    );

    await toolFailure("mempalace_list_drawers", null);
    assert.equal(
      await countDrawers("wing-e"),
      1,
      "the drawer survives entirely — nothing was deleted while MemPalace was unreachable",
    );
  });

  test("(f) grouped, filtered inventory across many wings, many CLIs, many periods", async () => {
    await resetFake();
    await seedDrawer(
      "wing-f1",
      makeContent("claude-code", "2026-01-10T00:00:00.000Z", newRecordId()),
    );
    await seedDrawer(
      "wing-f1",
      makeContent("gemini-cli", "2026-01-15T00:00:00.000Z", newRecordId()),
    );
    await seedDrawer(
      "wing-f2",
      makeContent("claude-code", "2026-02-10T00:00:00.000Z", newRecordId()),
    );
    await seedDrawer(
      "wing-f2",
      makeContent("copilot-cli", "2026-02-20T00:00:00.000Z", newRecordId()),
    );

    const run = runInventory(["--wing", "wing-f1,wing-f2", "--period", "2026-02", "--json"]);
    const parsed = parseOut(run);
    assert.equal(run.ec, 0);
    assert.equal(
      parsed.selectedTotal,
      2,
      "a period filter across many wings selects only that month's confirmed drawers (2 of 4)",
    );
    assert.deepEqual(
      parsed.byWing,
      { "wing-f2": 2 },
      "the filtered result is grouped by wing correctly (only wing-f2, count 2)",
    );
    assert.deepEqual(
      parsed.byCli,
      { "claude-code": 1, "copilot-cli": 1 },
      "the filtered result is grouped by CLI correctly (claude-code:1, copilot-cli:1)",
    );
  });

  test("(g) deleting exactly one confirmed drawer, addressed by its own MemPalace drawer id", async () => {
    await resetFake();
    const oneId = await seedDrawer(
      "wing-g",
      makeContent("claude-code", "2026-03-01T00:00:00.000Z", newRecordId()),
    );

    const run = runInventory(["delete", "--wing", "wing-g", "--commit", "--json"]);
    const parsed = parseOut(run);
    assert.equal(run.ec, 0, `expected outcome=deleted\n${run.err}`);
    assert.equal(parsed.outcome, "deleted");
    assert.deepEqual(
      parsed.deletedDrawerIds,
      [oneId],
      "exactly one drawer was deleted, addressed by its own drawer id",
    );
    assert.equal(await countDrawers("wing-g"), 0, "wing-g now holds zero drawers");
  });

  test("(h) a wing-scoped removal never reaches a confirmed drawer in another wing", async () => {
    await resetFake();
    await seedDrawer(
      "wing-h1",
      makeContent("claude-code", "2026-03-05T00:00:00.000Z", newRecordId()),
    );
    await seedDrawer(
      "wing-h2",
      makeContent("claude-code", "2026-03-05T00:00:00.000Z", newRecordId()),
    );

    const run = runInventory(["delete", "--wing", "wing-h1", "--commit", "--json"]);
    assert.equal(run.ec, 0, `the wing-h1-scoped delete run succeeds\n${run.err}`);
    assert.equal(await countDrawers("wing-h1"), 0, "wing-h1's confirmed drawer is deleted");
    assert.equal(
      await countDrawers("wing-h2"),
      1,
      "wing-h2's confirmed drawer is untouched despite sitting in the same room",
    );
  });

  test("(i) an all-wings sweep is the actual default when no --wing is given", async () => {
    await resetFake();
    await seedDrawer(
      "wing-i1",
      makeContent("claude-code", "2026-03-10T00:00:00.000Z", newRecordId()),
    );
    await seedDrawer(
      "wing-i2",
      makeContent("claude-code", "2026-03-10T00:00:00.000Z", newRecordId()),
    );

    const run = runInventory(["--json"]);
    const parsed = parseOut(run);
    assert.equal(run.ec, 0);
    assert.equal(parsed.scope, "all", "the default scope is reported as 'all'");
    assert.ok(
      parsed.wingsSwept?.includes("wing-i1") && parsed.wingsSwept.includes("wing-i2"),
      "both wings are named in the swept scope",
    );
    assert.equal(
      parsed.confirmedTotal,
      2,
      "both seeded drawers are confirmed in the all-wings sweep",
    );

    // An all-wings scope is itself "wide" (R16), regardless of drawer count.
    const refused = runInventory(["delete", "--commit", "--json"]);
    const refusedParsed = parseOut(refused);
    assert.notEqual(refused.ec, 0);
    assert.equal(
      refusedParsed.outcome,
      "confirmation-required",
      "an all-wings deletion refuses without --confirm-count, even below the drawer-count threshold",
    );

    const confirmed = runInventory([
      "delete",
      "--commit",
      "--confirm-count",
      String(refusedParsed.requiredConfirmCount),
      "--json",
    ]);
    const confirmedParsed = parseOut(confirmed);
    assert.equal(
      confirmed.ec,
      0,
      "supplying the exact --confirm-count for the all-wings scope allows the deletion to proceed",
    );
    assert.equal(confirmedParsed.outcome, "deleted");
  });

  test("(j) a delete_drawer answer of {success:false} is reported unconfirmed, not deleted (i1-F1)", async () => {
    await resetFake();
    const jId = await seedDrawer(
      "wing-j",
      makeContent("claude-code", "2026-03-25T00:00:00.000Z", newRecordId()),
    );

    await toolFailure("mempalace_delete_drawer", "success-false");
    const run = runInventory(["delete", "--wing", "wing-j", "--commit", "--json"]);
    const parsed = parseOut(run);
    assert.notEqual(run.ec, 0);
    assert.equal(
      parsed.outcome,
      "unconfirmed",
      "a {success:false} delete_drawer answer reports outcome=unconfirmed (never 'deleted')",
    );

    await toolFailure("mempalace_delete_drawer", null);
    assert.equal(
      await countDrawers("wing-j"),
      1,
      "the drawer survives: a {success:false} answer never removed it",
    );
    assert.ok(
      (await drawerIdsFor("wing-j")).includes(jId),
      "the surviving drawer is the same one, by id",
    );
  });

  test("(k) a get_drawer answer with no usable content aborts the sweep as unconfirmed, not excluded (i1-F2)", async () => {
    await resetFake();
    await seedDrawer(
      "wing-k",
      makeContent("claude-code", "2026-03-26T00:00:00.000Z", newRecordId()),
    );

    await toolFailure("mempalace_get_drawer", "no-content-error");
    const failing = runInventory(["--wing", "wing-k", "--json"]);
    const failingParsed = parseOut(failing);
    assert.notEqual(failing.ec, 0);
    assert.equal(
      failingParsed.outcome,
      "unconfirmed",
      "a content-less get_drawer payload aborts the WHOLE sweep as unconfirmed",
    );

    await toolFailure("mempalace_get_drawer", null);
    const recovered = runInventory(["--wing", "wing-k", "--json"]);
    const recoveredParsed = parseOut(recovered);
    assert.equal(
      recovered.ec,
      0,
      "clearing the injected shape restores normal confirmation (sanity check)",
    );
    assert.equal(recoveredParsed.confirmedTotal, 1);
  });

  test("(l) sweep()'s per-drawer fetch runs with bounded concurrency, correctly, across multiple chunks (i1-F3)", async () => {
    await resetFake();
    const CONC_WING = "wing-l";
    const CONC_COUNT = 10;
    const LATENCY_MS = 40;
    const concIds: string[] = [];
    for (let i = 1; i <= CONC_COUNT; i += 1) {
      concIds.push(
        await seedDrawer(
          CONC_WING,
          makeContent(
            "claude-code",
            `2026-04-${String(i).padStart(2, "0")}T00:00:00.000Z`,
            newRecordId(),
          ),
        ),
      );
    }

    await setLatency("mempalace_get_drawer", LATENCY_MS);

    // Force strictly-sequential behavior first (concurrency=1) — this is the
    // CORRECTNESS baseline: with CONC_COUNT drawers and a per-drawer
    // LATENCY_MS delay, this run must take at least CONC_COUNT * LATENCY_MS.
    const seqStart = Date.now();
    const seqRun = runInventory(["--wing", CONC_WING, "--json"], {
      CREWRIG_USAGE_INVENTORY_CONCURRENCY: "1",
    });
    const seqMs = Date.now() - seqStart;
    const seqParsed = parseOut(seqRun);
    assert.equal(seqRun.ec, 0);
    assert.equal(
      seqParsed.confirmedTotal,
      CONC_COUNT,
      `concurrency=1: all ${CONC_COUNT} seeded drawers are confirmed`,
    );
    const seqIds = (seqParsed.selected ?? []).map((d) => d.drawerId);
    for (const id of concIds)
      assert.ok(seqIds.includes(id), `expected drawer ${id} in the concurrency=1 selected set`);

    // Now with real concurrency — same drawers, same latency, higher concurrency.
    const concStart = Date.now();
    const concRun = runInventory(["--wing", CONC_WING, "--json"], {
      CREWRIG_USAGE_INVENTORY_CONCURRENCY: "8",
    });
    const concMs = Date.now() - concStart;
    const concParsed = parseOut(concRun);
    assert.equal(concRun.ec, 0);
    assert.equal(
      concParsed.confirmedTotal,
      CONC_COUNT,
      `concurrency=8: all ${CONC_COUNT} seeded drawers are STILL confirmed`,
    );
    const concIdsSelected = (concParsed.selected ?? []).map((d) => d.drawerId);
    for (const id of concIds)
      assert.ok(
        concIdsSelected.includes(id),
        `expected drawer ${id} in the concurrency=8 selected set`,
      );
    assert.deepEqual(
      seqParsed.selected,
      concParsed.selected,
      "the selected array is byte-identical between concurrency=1 and concurrency=8 (order preserved)",
    );

    await setLatency("mempalace_get_drawer", 0);

    assert.ok(
      seqMs >= CONC_COUNT * LATENCY_MS,
      `concurrency=1 baseline should take at least ${CONC_COUNT}x${LATENCY_MS}ms (${seqMs}ms), confirming the fixture's latency actually applies`,
    );
    // Generous margin: concurrency=8 over 10 drawers needs only 2 sequential
    // rounds (~2*40ms=80ms) plus overhead, vs. concurrency=1's ~400ms —
    // assert it is at least noticeably faster, not an exact ratio, to stay
    // robust on a loaded CI machine.
    assert.ok(
      concMs < seqMs,
      `expected concurrency=8 (${concMs}ms) to be faster than concurrency=1 (${seqMs}ms)`,
    );
  });

  test('(m) --wing "" is rejected with a clear error, never silently widened to all-wings (i1-F4)', async () => {
    await resetFake();
    const run = runInventory(["--wing", ""]);
    assert.equal(run.ec, 2, `expected exit 2 for --wing ""\n${run.err}`);
    assert.match(
      run.err.toLowerCase(),
      /empty/,
      "the error message names the empty-value condition",
    );
  });

  test("(extra) a plain inventory run makes no write of any kind (R13)", async () => {
    await resetFake();
    await seedDrawer(
      "wing-r13",
      makeContent("claude-code", "2026-03-20T00:00:00.000Z", newRecordId()),
    );
    const before_ = await countDrawers("wing-r13");
    runInventory(["--wing", "wing-r13", "--json"]);
    runInventory(["--wing", "wing-r13", "--json"]);
    const after_ = await countDrawers("wing-r13");
    assert.equal(before_, 1);
    assert.equal(after_, 1, "two plain inventory runs leave the drawer count unchanged");
  });

  test("(extra) text-mode output and basic CLI plumbing sanity", async () => {
    await resetFake();
    await seedDrawer(
      "wing-text",
      makeContent("claude-code", "2026-03-21T00:00:00.000Z", newRecordId()),
    );
    const run = runInventory(["--wing", "wing-text"]);
    assert.equal(run.ec, 0);
    assert.match(
      run.out,
      /scope: explicit/,
      "text-mode output (no --json) reports the scope in plain text",
    );

    const bad = runInventory(["--unrecognized-flag"]);
    assert.equal(bad.ec, 2, "an unrecognized CLI argument exits with status 2");
  });
});
