// session-check-throttle.test.ts — the Antigravity throttle of the session-start
// check (spec 0246 R8, R9; plan v4 step 3, v3 step 4).
//
// End to end: `mempalace-session-check.ts antigravity` with `PreInvocation`
// payloads on stdin, against a fake endpoint, in a scratch HOME. The probe count
// at the fake server is the observable: a suppressed invocation must not probe.
// Expiry and the id bound are decided by the pure `decideThrottle`, driven with
// explicit clocks.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  type Sandbox,
  assertNoCliInvoked,
  makeSandbox,
  mkfifo,
  runCheck,
  startFakeServer,
  writeConfig,
  writeLauncher,
} from "./lib/session-check-harness.ts";
import { SESSION_CHECK_CHANNELS } from "../lib/mempalace-registration.ts";
import {
  ANTIGRAVITY_SESSION_CHECK,
  EMPTY_THROTTLE_STATE,
  THROTTLE_MAX_IDS,
  THROTTLE_WINDOW_MS,
  type ThrottleState,
  decideThrottle,
  throttleStatePath,
} from "../lib/session-check-throttle.ts";

const KEY = ANTIGRAVITY_SESSION_CHECK.key;
const SPEAKS =
  SESSION_CHECK_CHANNELS.antigravity.user !== null ||
  SESSION_CHECK_CHANNELS.antigravity.model !== null;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const payload = (n: number, conversation?: string): string =>
  JSON.stringify({
    invocationNum: n,
    initialNumSteps: 0,
    ...(conversation !== undefined && KEY !== null ? { [KEY]: conversation } : {}),
  });

/** A machine where Antigravity CLI has no `mempalace` entry and the daemon serves. */
async function absentMachine(): Promise<{
  sb: Sandbox;
  server: Awaited<ReturnType<typeof startFakeServer>>;
}> {
  const server = await startFakeServer("auth-refusal");
  const sb = makeSandbox();
  writeLauncher(sb, server.port);
  writeConfig(sb, "antigravity", { mcpServers: {} });
  return { sb, server };
}

describe("the Antigravity throttle, end to end (R8)", () => {
  test("one conversation, four invocations: one probe, and at most one warning", async (t) => {
    if (KEY === null)
      return t.skip("the payload carries no conversation identifier (step 1(a) evidence)");
    const { sb, server } = await absentMachine();
    try {
      const outputs: string[] = [];
      for (let n = 1; n <= 4; n++) {
        const r = await runCheck(sb, "antigravity", { input: payload(n, "conv-A") });
        assert.equal(r.status, 0);
        outputs.push(r.stdout);
      }

      assert.equal(server.requests.length, 1);
      assert.deepEqual(outputs.slice(1), ["", "", ""], "a suppressed invocation emits nothing");
      assert.equal(
        outputs[0] !== "",
        SPEAKS,
        "the first invocation warns exactly when Antigravity has a channel",
      );
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });

  test("no conversation identifier: two conversations of four invocations within 30 minutes probe once", async (t) => {
    const { sb, server } = await absentMachine();
    try {
      const timings: number[] = [];
      let warnings = 0;
      for (let conv = 0; conv < 2; conv++) {
        for (let n = 1; n <= 4; n++) {
          const r = await runCheck(sb, "antigravity", { input: payload(n) });
          assert.equal(r.status, 0);
          if (r.stdout !== "") warnings++;
          if (conv + n > 1) timings.push(r.ms);
        }
      }

      assert.equal(server.requests.length, 1);
      assert.equal(warnings, SPEAKS ? 1 : 0);
      timings.sort((a, b) => a - b);
      t.diagnostic(
        `suppressed path, sh + node, wall clock: p50 ${Math.round(timings[3] ?? 0)} ms, max ${Math.round(timings.at(-1) ?? 0)} ms`,
      );
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });

  test("a payload on a stdin the CLI keeps open does not stall the check", async () => {
    const { sb, server } = await absentMachine();
    try {
      const r = await runCheck(sb, "antigravity", {
        input: payload(1, "conv-open"),
        keepStdinOpen: true,
      });

      assert.equal(r.status, 0);
      assert.ok(r.ms < 1500, `${Math.round(r.ms)} ms: the check waited for end of input`);
      assert.equal(server.requests.length, 1);
    } finally {
      await server.close();
    }
  });

  test("the state is private: directory 0700, file 0600, a pre-existing wide directory narrowed", async () => {
    const { sb, server } = await absentMachine();
    try {
      const state = throttleStatePath(sb.home);
      fs.mkdirSync(path.dirname(state), { recursive: true, mode: 0o755 });
      fs.chmodSync(path.dirname(state), 0o755);

      const r = await runCheck(sb, "antigravity", { input: payload(1, "conv-modes") });

      assert.equal(r.status, 0);
      assert.equal(fs.statSync(path.dirname(state)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(state).mode & 0o777, 0o600);
      assert.equal(
        state,
        path.join(sb.home, ".crewrig", "state", "session-check", "antigravity.json"),
      );
    } finally {
      await server.close();
    }
  });

  test("the state file as a FIFO never blocks the check", async () => {
    const { sb, server } = await absentMachine();
    try {
      mkfifo(throttleStatePath(sb.home));

      const r = await runCheck(sb, "antigravity", { input: payload(1, "conv-fifo") });

      assert.equal(r.status, 0);
      assert.ok(r.ms < 1500, `${Math.round(r.ms)} ms: blocked on the FIFO until the deadline`);
      assertNoCliInvoked(sb);
    } finally {
      await server.close();
    }
  });
});

describe("decideThrottle (R8 State: bounded, expiring)", () => {
  const T0 = 1_700_000_000_000;

  test("the 30-minute window suppresses until it expires", () => {
    const first = decideThrottle(EMPTY_THROTTLE_STATE, null, T0);
    assert.equal(first.proceed, true);

    assert.equal(decideThrottle(first.next, null, T0 + THROTTLE_WINDOW_MS - 1).proceed, false);
    assert.equal(decideThrottle(first.next, null, T0 + THROTTLE_WINDOW_MS).proceed, true);
    assert.equal(THROTTLE_WINDOW_MS, 30 * MIN);
  });

  test("a conversation id is remembered for 24 h, then checked again", () => {
    const first = decideThrottle(EMPTY_THROTTLE_STATE, "c1", T0);
    assert.equal(first.proceed, true);

    assert.equal(decideThrottle(first.next, "c1", T0 + 23 * HOUR).proceed, false);
    assert.equal(decideThrottle(first.next, "c2", T0 + MIN).proceed, true);
    assert.equal(decideThrottle(first.next, "c1", T0 + 24 * HOUR).proceed, true);
  });

  test("a timestamp in the future does not silence the check", () => {
    const skewed: ThrottleState = { windowStart: T0 + HOUR, ids: [["c1", T0 + HOUR]] };

    assert.equal(decideThrottle(skewed, null, T0).proceed, true);
    assert.equal(decideThrottle(skewed, "c1", T0).proceed, true);
  });

  test("1000 conversations keep at most 64 ids, the newest", () => {
    let state: ThrottleState = EMPTY_THROTTLE_STATE;
    for (let i = 0; i < 1000; i++) state = decideThrottle(state, `c${i}`, T0 + i).next;

    assert.ok(
      state.ids.length <= THROTTLE_MAX_IDS && THROTTLE_MAX_IDS <= 64,
      `${state.ids.length} ids`,
    );
    assert.ok(state.ids.some(([id]) => id === "c999"));
    assert.ok(!state.ids.some(([id]) => id === "c0"));
    assert.equal(decideThrottle(state, "c999", T0 + 1000).proceed, false);
  });
});
