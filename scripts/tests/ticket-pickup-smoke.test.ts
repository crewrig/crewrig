// ticket-pickup-smoke.test.ts — smoke tests of the spec 0244 pickup check:
// a few ownership-model rows and three end-to-end runs of `main` against a
// minimal in-process GitHub double injected through the `run` seam. The full
// suite (every scenario on every forge, interleavings) lives in
// scripts/tests/ticket-ownership.test.ts and scripts/tests/ticket-pickup.test.ts.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RunResult } from "../lib/forge-detect.ts";
import type { AssignmentItem, AssignmentRecord } from "../lib/ticket-ownership.ts";
import { determine } from "../lib/ticket-ownership.ts";
import { ASSIGN_REQUEST_MARKER, main } from "../lib/ticket-pickup.ts";

const T0 = Date.parse("2026-09-30T10:00:00Z");

function rec(current: string[], items: AssignmentItem[], creation = true): AssignmentRecord {
  return { current, items, createdAt: T0, author: "a", recordsCreationAssignees: creation };
}

describe("ownership model", () => {
  test("a one-change replacement does not free the issue: the first taker still owns it", () => {
    const d = determine(
      rec(
        ["b"],
        [
          { at: T0 + 1000, actor: "a", user: "a", op: "add" },
          { at: T0 + 5000, actor: "b", user: "a", op: "remove" },
          { at: T0 + 5000, actor: "b", user: "b", op: "add" },
        ],
      ),
    );
    assert.deepEqual(d, { kind: "owned", owner: "a", since: T0 + 1000 });
  });

  test("two actors taking a free issue in the same second is a tie", () => {
    const d = determine(
      rec(
        ["a", "b"],
        [
          { at: T0 + 1000, actor: "a", user: "a", op: "add" },
          { at: T0 + 1000, actor: "b", user: "b", op: "add" },
        ],
      ),
    );
    assert.equal(d.kind, "tie");
  });

  test("v2-F1: an unrecorded current assignee next to recorded items is inconsistent, not seeded", () => {
    const d = determine(
      rec(["a", "b"], [{ at: T0 + 1000, actor: "a", user: "a", op: "add", group: "1" }], false),
    );
    assert.equal(d.kind, "inconsistent");
  });
});

interface Gh {
  assignees: string[];
  events: {
    event: string;
    created_at: string;
    actor: { login: string };
    assignee: { login: string };
  }[];
  comments: { created_at: string; body: string }[];
  dropSelf: boolean;
}

function fakeGh(state: Gh, self: string): (argv: readonly string[]) => Promise<RunResult> {
  const ok = (v: unknown): RunResult => ({ status: 0, stdout: JSON.stringify(v), stderr: "" });
  const lines = (vs: unknown[]): RunResult => ({
    status: 0,
    stdout: vs.map((v) => JSON.stringify(v)).join("\n"),
    stderr: "",
  });
  let tick = 0;
  return async (argv) => {
    const rest = argv.slice(4);
    const method = rest.includes("-X") ? rest[rest.indexOf("-X") + 1] : "GET";
    const path =
      rest.find(
        (a, i) =>
          !a.startsWith("-") &&
          rest[i - 1] !== "-X" &&
          rest[i - 1] !== "-f" &&
          rest[i - 1] !== "--jq",
      ) ?? "";
    const field = rest[rest.indexOf("-f") + 1] ?? "";
    const at = new Date(T0 + 60_000 + 1000 * tick++).toISOString();
    if (path === "user") return ok({ login: self });
    if (/\/issues\/\d+$/.test(path))
      return ok({
        assignees: state.assignees.map((login) => ({ login })),
        created_at: new Date(T0).toISOString(),
        user: { login: "author" },
      });
    if (path.includes("/timeline")) return lines(state.events);
    if (path.includes("/comments") && method === "GET") return lines(state.comments);
    if (path.includes("/comments")) {
      state.comments.push({ created_at: at, body: field.slice("body=".length) });
      return ok({});
    }
    if (path.endsWith("/assignees") && method === "POST") {
      const user = field.slice("assignees[]=".length);
      if (state.dropSelf) return ok({});
      state.assignees.push(user);
      state.events.push({
        event: "assigned",
        created_at: at,
        actor: { login: self },
        assignee: { login: user },
      });
      return ok({});
    }
    return { status: 1, stdout: "", stderr: `unexpected ${method} ${path}` };
  };
}

async function pickup(
  state: Gh,
  self: string,
): Promise<{ code: number; out: { verdict: string; owner: string | null } }> {
  const out: string[] = [];
  const code = await main(["--issue", "7"], {
    run: fakeGh(state, self),
    env: {},
    remoteUrl: () => "git@github.com:acme/widgets.git",
    readConfig: () => null,
    sleep: async () => {},
    out: (l) => out.push(l),
    err: () => {},
  });
  return { code, out: JSON.parse(out[0] ?? "{}") as { verdict: string; owner: string | null } };
}

describe("pickup end to end (GitHub double)", () => {
  test("a free issue is self-assigned, confirmed, and proceeds (exit 0)", async () => {
    const state: Gh = { assignees: [], events: [], comments: [], dropSelf: false };
    const r = await pickup(state, "alice");
    assert.equal(r.code, 0);
    assert.equal(r.out.owner, "alice");
    assert.deepEqual(state.assignees, ["alice"]);
  });

  test("v2-F2: a silently dropped self-assignment exits 5 and asks a maintainer once", async () => {
    const state: Gh = { assignees: [], events: [], comments: [], dropSelf: true };
    assert.equal((await pickup(state, "fork-dev")).code, 5);
    assert.equal((await pickup(state, "fork-dev")).code, 5);
    assert.equal(state.comments.filter((c) => c.body.includes(ASSIGN_REQUEST_MARKER)).length, 1);
  });

  test("an issue owned by someone else is refused without any write (exit 3)", async () => {
    const state: Gh = {
      assignees: ["alice"],
      events: [
        {
          event: "assigned",
          created_at: new Date(T0 + 1000).toISOString(),
          actor: { login: "alice" },
          assignee: { login: "alice" },
        },
      ],
      comments: [],
      dropSelf: false,
    };
    const r = await pickup(state, "bob");
    assert.equal(r.code, 3);
    assert.equal(r.out.owner, "alice");
    assert.deepEqual(state.assignees, ["alice"]);
  });
});
