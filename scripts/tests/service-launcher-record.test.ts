// service-launcher-record.test.ts — scripts/lib/service/launcher-record.ts
// (spec 0252 requirement 10, delta-01): the record is read unchanged by
// parseLauncher and by the shell's mcp_installed_endpoint, and fails loudly
// when executed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseLauncher } from "../lib/mempalace-registration.ts";
import {
  parseRecord,
  programPathFor,
  recordForm,
  renderRecord,
} from "../lib/service/launcher-record.ts";
import type { RecordFields } from "../lib/service/launcher-record.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SHA = "ab".repeat(32);
const FIELDS: RecordFields = {
  host: "127.0.0.1",
  port: "41893",
  sourceSha: SHA,
  program: "/home/agent/.crewrig/mcp-daemon-launcher.ts",
};
const posix = process.platform === "win32" ? { skip: "POSIX only" } : {};

test("the program path replaces .sh by .ts and appends .ts otherwise", () => {
  assert.equal(
    programPathFor("/h/.crewrig/mcp-daemon-launcher.sh"),
    "/h/.crewrig/mcp-daemon-launcher.ts",
  );
  assert.equal(programPathFor("/h/launcher"), "/h/launcher.ts");
  assert.equal(programPathFor("/h/launcher.bash"), "/h/launcher.bash.ts");
});

test("render then parse: the four lines round-trip", () => {
  const text = renderRecord(FIELDS);
  assert.deepEqual(parseRecord(text), FIELDS);
  assert.match(text, /^MCP_HOST="127\.0\.0\.1"$/m);
  assert.match(text, /^LAUNCHER_PROGRAM="\/home\/agent\/\.crewrig\/mcp-daemon-launcher\.ts"$/m);
});

test("parseLauncher reads the record unchanged", () => {
  const endpoint = parseLauncher(renderRecord(FIELDS));
  assert.equal(endpoint?.url, "http://127.0.0.1:41893/mcp");
  assert.equal(endpoint?.loopback, true);
});

test("the two forms are told apart by LAUNCHER_PROGRAM", () => {
  const ts = recordForm(renderRecord(FIELDS));
  assert.equal(ts.form, "typescript");
  assert.equal(ts.form === "typescript" ? ts.program : "", FIELDS.program);
  assert.equal(recordForm('#!/usr/bin/env bash\nMCP_HOST="::1"\nMCP_PORT="8000"\n').form, "shell");
  assert.equal(recordForm("nothing here").form, "unrecognised");
  assert.equal(parseRecord('MCP_HOST="::1"\nMCP_PORT="8000"\n'), null);
});

test("fields the readers would not take back are refused", () => {
  assert.throws(() => renderRecord({ ...FIELDS, host: "__MCP_HOST__" }), RangeError);
  assert.throws(() => renderRecord({ ...FIELDS, port: "70000x" }), RangeError);
  assert.throws(() => renderRecord({ ...FIELDS, sourceSha: "zz" }), RangeError);
  assert.throws(() => renderRecord({ ...FIELDS, program: 'a"b' }), RangeError);
});

test("mcp_installed_endpoint (the real shell function) reads the rendered record", posix, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "launcher-record-"));
  try {
    const record = path.join(dir, "mcp-daemon-launcher.sh");
    writeFileSync(record, renderRecord(FIELDS));
    const run = spawnSync("bash", ["-c", ". scripts/lib/common.sh; mcp_installed_endpoint"], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, MEMPALACE_MCP_LAUNCHER_PATH: record },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.trim(), "http://127.0.0.1:41893/mcp");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the record body fails loudly and names the program", posix, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "launcher-record-"));
  try {
    const record = path.join(dir, "mcp-daemon-launcher.sh");
    const program = "/h/it's/launcher.ts";
    writeFileSync(record, renderRecord({ ...FIELDS, program }));
    chmodSync(record, 0o755);
    const run = spawnSync("/bin/sh", [record], { encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.ok(run.stderr.includes(program), run.stderr);
    assert.equal(run.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
