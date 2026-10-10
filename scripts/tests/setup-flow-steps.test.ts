// setup-flow-steps.test.ts — the common steps of steps.ts and session-check.ts through the flow
// (spec 0256 requirements 18-20): ensure-home, the TLS merge into the flow-owned env, deps-install
// and the session-check registration. A temporary home and repository stand in for the real ones.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import type { Spawner } from "../lib/setup/context.ts";
import type { StepFn } from "../lib/setup/descriptor.ts";
import { SESSION_CHECK_FAILED } from "../lib/setup/session-check.ts";
import { descriptor, recorder, run, sandbox, useSandbox } from "./setup-flow-fixtures.ts";

useSandbox();

describe("common steps", () => {
  test("ensure-home creates the rules directory; an impossible one exits 1 with one Error line", async () => {
    const ok = await run(descriptor(["ensure-home"]), {});
    assert.equal(ok.status, 0);
    assert.ok(fs.statSync(path.join(sandbox.tmp, ".fake", "rules")).isDirectory());
    fs.writeFileSync(path.join(sandbox.tmp, ".blocker"), "");
    const blocked = {
      ...descriptor(["ensure-home"]),
      homes: { cliHome: ".b", rulesDir: ".blocker/rules", skillsDir: "s" },
    };
    const bad = await run(blocked, {});
    assert.equal(bad.status, 1);
    assert.match(bad.err, /^Error: cannot create .*\.blocker.rules: .+\n$/);
  });

  test("tls-offer merges the CA variables into the flow-owned env, not into the caller's", async () => {
    const ca = path.join(sandbox.tmp, "ca.pem");
    fs.writeFileSync(ca, "x\n");
    const env = { TLS_DELEGATION: "on", CREWRIG_TLS_CA: ca };
    let seen: Record<string, string | undefined> = {};
    const probe: StepFn = async ({ ctx, state }) => {
      assert.equal(ctx.env, state.env);
      seen = { ...ctx.env };
    };
    const result = await run(descriptor(["tls-offer", "mcp"]), { mcp: probe }, { env });
    assert.equal(result.status, 0);
    assert.ok(result.out.includes("Custom CA trust configured"));
    assert.ok(result.out.endsWith("\n\n"));
    assert.equal(seen["SSL_CERT_FILE"], ca);
    assert.equal(env["SSL_CERT_FILE" as keyof typeof env], undefined);
  });

  test("deps-install exits 1 on a directory that is not a checkout, with no trailing blank line", async () => {
    const result = await run(descriptor(["deps-install", "mcp"]), { mcp: recorder([], "mcp") });
    assert.equal(result.status, 1);
    assert.equal(result.out, "");
    assert.match(result.err, /is not a repository checkout/);
  });

  test("session-check runs the floor guard then the registration; a failure prints one line and continues", async () => {
    const calls: string[][] = [];
    const spawn =
      (status: number): Spawner =>
      (argv) => {
        calls.push([...argv]);
        return { status, stdout: "", stderr: "" };
      };
    const good = await run(descriptor(["session-check"], "gemini"), {}, { spawn: spawn(0) });
    assert.equal(good.err, "");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], [
      "node",
      path.join(sandbox.tmp, "scripts", "lib", "node-floor-guard.js"),
    ]);
    assert.deepEqual(calls[1]?.slice(-2), ["register", "gemini"]);
    calls.length = 0;
    const bad = await run(
      descriptor(["session-check", "mcp"]),
      { mcp: recorder([], "mcp") },
      { spawn: spawn(1) },
    );
    assert.equal(bad.status, 0);
    assert.equal(calls.length, 1);
    assert.equal(bad.err, `${SESSION_CHECK_FAILED}\n`);
  });
});
