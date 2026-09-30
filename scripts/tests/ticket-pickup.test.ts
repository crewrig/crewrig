// ticket-pickup.test.ts — the spec 0244 pickup check end to end: `main(argv,
// deps)` against the hermetic fake forge of scripts/tests/fixtures/ticket-pickup/
// (real gh / glab / tea wire shapes, virtual clock, no PATH shims).
//
// - every spec 0244 scenario on GitHub, GitLab and Gitea;
// - repairs never leave the issue readable as free (R4), on add- and
//   replace-semantics forges;
// - R13 fail-closed and precedence, R14 silent drop (v2-F2), --read-only,
//   exit codes 0-5;
// - the exhaustive two-pickup interleaving property test (PLAN v2 step 6).
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/ticket-pickup.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Knobs, PickupResult } from "./fixtures/ticket-pickup/fake-forge.ts";
import { DAY, FakeForge, pickup } from "./fixtures/ticket-pickup/fake-forge.ts";
import { exhaust } from "./fixtures/ticket-pickup/interleave.ts";
import type { PickupDeps } from "../lib/ticket-pickup.ts";
import { ASSIGN_REQUEST_MARKER } from "../lib/ticket-pickup.ts";

type Make = (k?: Partial<Knobs>) => FakeForge;
const FORGES: [string, Make][] = [
  ["GitHub", (k) => new FakeForge("github", k)],
  ["GitLab", (k) => new FakeForge("gitlab", k)],
  ["Gitea", (k) => new FakeForge("gitea", k)],
];

/** No state after the first agent write may be empty (R4 *Repairs preserve ownership*). */
function neverFree(f: FakeForge, n = 7): void {
  assert.deepEqual(f.emptyAfterAgentWrite(n), [], "an agent write left the issue readable as free");
}

function expect(r: PickupResult, code: number, owner?: string | null): void {
  assert.equal(r.code, code, `exit ${r.code} (${r.report.verdict}): ${r.stderr}`);
  assert.equal(r.report.exit, code);
  if (owner !== undefined) assert.equal(r.report.owner, owner);
}

/** Deps that run `first()` (another contributor's whole pickup) just before `login`'s first write. */
function holdBeforeWrite(
  f: FakeForge,
  login: string,
  first: () => Promise<unknown>,
): Partial<PickupDeps> {
  const direct = f.runAs(login);
  let held = false;
  return {
    run: async (argv) => {
      if (!held && argv.includes("-X") && !argv.includes("GET")) {
        held = true;
        await first();
      }
      return direct(argv);
    },
  };
}

const writesBy = (f: FakeForge, login: string): string[] =>
  f.writes.filter((w) => w.startsWith(`${login}:`));

for (const [label, make] of FORGES) {
  describe(`spec 0244 scenarios on ${label}`, () => {
    test("an agent takes a free ticket for its user, and the take is visible to everyone", async () => {
      const f = make().issue(7);
      expect(await pickup(f, "alice", 7), 0, "alice");
      assert.deepEqual(f.assignees(7), ["alice"]);
      assert.equal(writesBy(f, "alice").length, 1);
      expect(await pickup(f, "bob", 7, ["--read-only"]), 0, "alice");
    });

    test("an agent refuses a ticket owned by someone else, naming the owner and the paths", async () => {
      const f = make()
        .issue(7)
        .human("alice", 7, { add: ["alice"] });
      const r = await pickup(f, "bob", 7);
      expect(r, 3, "alice");
      assert.match(r.stderr, /owned by 'alice'.*ask the owner.*stale-lock.*another ticket/);
      assert.deepEqual(f.writes, []);
    });

    test("the ownership check cannot be performed: forge unreachable or identity unknown", async () => {
      const down = make({ unreachable: true }).issue(7);
      const r = await pickup(down, "alice", 7);
      expect(r, 2, null);
      assert.match(r.stderr, /error connecting/);
      const anon = make({ identityFails: true }).issue(7);
      expect(await pickup(anon, "alice", 7), 2, null);
      assert.deepEqual([...down.writes, ...anon.writes], []);
      const noRemote = await pickup(make().issue(7), "alice", 7, [], { remoteUrl: () => null });
      expect(noRemote, 2);
      assert.match(noRemote.stderr, /BASE_REF/);
    });

    test("two assignments at the same instant: nobody owns it until settled by agreement", async () => {
      const f = make()
        .issue(7)
        .human("alice", 7, { add: ["alice"] })
        .human("bob", 7, { add: ["bob"] });
      for (const who of ["alice", "bob"]) {
        const r = await pickup(f, who, 7);
        expect(r, 4, null);
        assert.match(r.stderr, new RegExp(`own assignment of '${who}' left in place`));
      }
      assert.deepEqual(f.writes, []);
      f.advance(60_000)
        .say("alice", 7, "Agreed: bob takes it.")
        .human("alice", 7, { remove: ["alice", "bob"] });
      f.advance(60_000);
      expect(await pickup(f, "bob", 7), 0, "bob");
      expect(await pickup(f, "alice", 7), 3, "bob");
    });

    test("a stale ticket is taken over openly; the tool itself never takes over (R8)", async () => {
      const f = make()
        .issue(7)
        .human("alice", 7, { add: ["alice"] })
        .advance(14 * DAY);
      f.say("bob", 7, "@alice may I take this over?").advance(7 * DAY);
      expect(await pickup(f, "bob", 7), 3, "alice");
      f.human("bob", 7, { remove: ["alice"] })
        .advance(1000)
        .human("bob", 7, { add: ["bob"] });
      f.say("bob", 7, "Taking over, see the unanswered request above.");
      const r = await pickup(f, "bob", 7, [], {
        readConfig: () =>
          'ticket_nudge_days = "10"\n# ticket_grace_days = "1"\nticket_grace_days = "3"\n',
      });
      expect(r, 0, "bob");
      assert.deepEqual(r.report.delays, { nudge_days: 10, grace_days: 3 });
      expect(await pickup(f, "alice", 7), 3, "bob");
    });

    test("an epic assignment does not lock its sub-tickets", async () => {
      const f = make()
        .issue(1)
        .human("alice", 1, { add: ["alice"] })
        .issue(2);
      expect(await pickup(f, "bob", 2), 0, "bob");
      assert.deepEqual(f.assignees(1), ["alice"]);
      assert.equal(
        f.calls.some((c) => /issues\/1(\/|$|\?)/.test(c)),
        false,
      );
    });

    test("two contributors take the same free ticket: the first recorded wins, the other withdraws", async () => {
      const f = make().issue(7);
      let alice: PickupResult | undefined;
      const bob = await pickup(
        f,
        "bob",
        7,
        [],
        holdBeforeWrite(f, "bob", async () => (alice = await pickup(f, "alice", 7))),
      );
      assert.ok(alice !== undefined);
      expect(alice, 0, "alice");
      expect(bob, 3, "alice");
      assert.deepEqual(f.assignees(7), ["alice"]);
      neverFree(f);
    });

    test("on a forge that replaces assignments, the later self-assignment withdraws and restores the owner", async () => {
      // GitLab replaces through its stale-read PUT; GitHub and Gitea through the replace-on-add knob.
      const f = make({ replaceOnAdd: true, singleAssignee: true }).issue(7);
      const bob = await pickup(
        f,
        "bob",
        7,
        [],
        holdBeforeWrite(f, "bob", () => pickup(f, "alice", 7)),
      );
      expect(bob, 3, "alice");
      assert.deepEqual(f.assignees(7), ["alice"]);
      assert.ok(
        f.mutations.some(
          (m) => m.actor === "bob" && m.steps.some((s) => s.op === "remove" && s.user === "alice"),
        ),
      );
      neverFree(f);
    });

    for (const first of ["bob", "alice"])
      test(`a session interrupted right after a displacing self-assignment: ${first} picks up first`, async () => {
        const f = make()
          .issue(7)
          .human("alice", 7, { add: ["alice"] })
          .advance(5000);
        f.mutate(
          7,
          "bob",
          [
            { user: "alice", op: "remove" },
            { user: "bob", op: "add" },
          ],
          { agent: true },
        );
        f.advance(60_000);
        if (first === "alice") {
          expect(await pickup(f, "alice", 7), 0, "alice");
          assert.ok(f.assignees(7).includes("alice"));
        }
        expect(await pickup(f, "bob", 7), 3, "alice");
        assert.deepEqual(f.assignees(7), ["alice"]);
        neverFree(f);
      });

    test("a contributor without assign permission: exit 5, one maintainer request, no retry (R14, v2-F2)", async () => {
      const f = make({ cannotAssign: new Set(["fork-dev"]) }).issue(7);
      const r = await pickup(f, "fork-dev", 7);
      expect(r, 5, null);
      assert.equal(
        writesBy(f, "fork-dev").filter((w) => !w.includes("comment")).length,
        1,
        "the self-assignment was retried",
      );
      expect(await pickup(f, "fork-dev", 7), 5);
      const asks = f.comments.filter((c) => c.body.includes(ASSIGN_REQUEST_MARKER));
      assert.equal(asks.length, 1);
      assert.match(asks[0]?.body ?? "", /@fork-dev/);
      assert.deepEqual(f.assignees(7), []);
      f.advance(DAY).human("maintainer", 7, { add: ["fork-dev"] });
      expect(await pickup(f, "fork-dev", 7), 0, "fork-dev");
    });

    test("the contributor about to merge inspects someone else's ticket without writing (read-only)", async () => {
      const f = make()
        .issue(7)
        .human("alice", 7, { add: ["alice"] });
      const r = await pickup(f, "bob", 7, ["--read-only"]);
      expect(r, 0, "alice");
      assert.equal(r.report.verdict, "owned-by-other");
      assert.deepEqual(f.writes, []);
    });

    test("a ticket changes hands with the owner's consent, through the free state only", async () => {
      const f = make()
        .issue(7)
        .human("alice", 7, { add: ["alice"] })
        .advance(DAY);
      f.say("bob", 7, "@alice can I take this?");
      expect(await pickup(f, "bob", 7), 3, "alice");
      f.advance(DAY)
        .say("alice", 7, "@bob yes, it's yours.")
        .human("alice", 7, { remove: ["alice"] });
      f.advance(1000).human("alice", 7, { add: ["bob"] });
      expect(await pickup(f, "bob", 7), 0, "bob");
      expect(await pickup(f, "alice", 7), 3, "bob");
    });

    test("a hand-over that skips the free state is not recognised: the old owner is restored", async () => {
      const f = make()
        .issue(7)
        .human("alice", 7, { add: ["alice"] })
        .advance(DAY);
      f.human("alice", 7, { remove: ["alice"], add: ["bob"] }).advance(DAY);
      expect(await pickup(f, "bob", 7), 3, "alice");
      assert.deepEqual(f.assignees(7), ["alice"]);
      neverFree(f);
    });

    test("a contributor releases a ticket; the next contributor's agent takes it", async () => {
      const f = make()
        .issue(7)
        .human("alice", 7, { add: ["alice"] })
        .advance(DAY);
      f.human("alice", 7, { remove: ["alice"] }).say("alice", 7, "Done: parser. Remaining: tests.");
      f.advance(DAY);
      expect(await pickup(f, "carol", 7), 0, "carol");
    });
  });

  describe(`R4, R13, R14 edges on ${label}`, () => {
    test("an own-write whose history item lags is re-read, then the pickup proceeds", async () => {
      const f = make({ itemLag: 3000 }).issue(7);
      expect(await pickup(f, "alice", 7), 0, "alice");
    });

    test("an own-write whose history item never shows up fails closed after the bounded re-reads", async () => {
      const f = make({ itemLag: 10 * DAY }).issue(7);
      const r = await pickup(f, "alice", 7);
      expect(r, 2, null);
      assert.match(r.stderr, /not visible in the history after 5 reads; left in place/);
      assert.deepEqual(f.assignees(7), ["alice"]);
    });

    test("R13 prevails: a same-second rival appearing after the first read stops the pickup (exit 4)", async () => {
      const f = make({ lagFor: new Map([["bob", 1500]]) }).issue(7);
      f.afterWrite = (actor) => {
        if (actor !== "alice") return;
        f.afterWrite = null;
        f.mutate(7, "bob", [{ user: "bob", op: "add" }], { agent: true });
      };
      const r = await pickup(f, "alice", 7);
      expect(r, 4, null);
      assert.match(r.stderr, /own assignment of 'alice' left in place/);
      assert.equal(writesBy(f, "alice").length, 1, "an undecidable pickup must not repair");
    });

    test("a write failing partway exits 2 and names the state left in place", async () => {
      const f = make({ failWrite: label === "GitLab" ? 1 : 2 })
        .issue(7)
        .human("alice", 7, { add: ["alice"] });
      f.advance(5000).mutate(
        7,
        "bob",
        [
          { user: "alice", op: "remove" },
          { user: "bob", op: "add" },
        ],
        { agent: true },
      );
      const r = await pickup(f, "bob", 7);
      expect(r, 2, null);
      assert.ok(
        r.report.actions.some((a) => !a.ok),
        JSON.stringify(r.report.actions),
      );
      assert.match(r.stderr, /writes: .*FAILED/);
      neverFree(f);
    });

    test("--read-only writes nothing whatever the verdict", async () => {
      const cases: [string, (f: FakeForge) => void, number][] = [
        ["free", () => {}, 0],
        [
          "intruder",
          (f) =>
            void f
              .human("alice", 7, { add: ["alice"] })
              .advance(5000)
              .human("bob", 7, { add: ["bob"] }),
          0,
        ],
        [
          "displaced self",
          (f) =>
            void f
              .human("bob", 7, { add: ["bob"] })
              .advance(5000)
              .human("x", 7, { remove: ["bob"], add: ["x"] }),
          0,
        ],
        [
          "tie",
          (f) => void f.human("alice", 7, { add: ["alice"] }).human("bob", 7, { add: ["bob"] }),
          4,
        ],
      ];
      for (const [name, setup, code] of cases) {
        const f = make().issue(7);
        setup(f);
        assert.equal((await pickup(f, "bob", 7, ["--read-only"])).code, code, name);
        assert.deepEqual(f.writes, [], name);
      }
    });

    test("an issue created pre-assigned is owned by its creation assignee", async () => {
      const f = make().issue(7, "author", ["alice"]);
      expect(await pickup(f, "bob", 7), 3, "alice");
      expect(await pickup(f, "alice", 7), 0, "alice");
    });

    test("a history spread over several pages is read to the end", async () => {
      const f = make().issue(7);
      for (let i = 0; i < 60; i++) f.advance(1000).say("carol", 7, `note ${i}`);
      f.advance(1000).human("alice", 7, { add: ["alice"] });
      expect(await pickup(f, "bob", 7), 3, "alice");
    });

    test("a torn first read (a rival write between the issue and history GETs) is re-read once", async () => {
      const f = make().issue(7);
      const direct = f.runAs("bob");
      let torn = false;
      const run = async (argv: readonly string[]) => {
        const res = await direct(argv);
        if (!torn && /issues\/7(\?|$)/.test(argv[argv.length - 1] ?? "")) {
          torn = true;
          f.human("alice", 7, { add: ["alice"] });
        }
        return res;
      };
      const r = await pickup(f, "bob", 7, [], { run });
      assert.ok(torn, "the tear was not injected");
      expect(r, 3, "alice");
      assert.deepEqual(f.writes, []);
    });

    test("a record that keeps changing between confirming reads fails closed", async () => {
      const f = make().issue(7);
      const direct = f.runAs("alice");
      let flip = false;
      const run = async (argv: readonly string[]) => {
        const res = await direct(argv);
        if (/timeline|notes/.test(argv.join(" ")) && f.assignees(7).includes("alice")) {
          f.human("carol", 7, flip ? { remove: ["carol"] } : { add: ["carol"] });
          flip = !flip;
          f.advance(1000);
        }
        return res;
      };
      const r = await pickup(f, "alice", 7, [], { run });
      expect(r, 2, null);
      assert.match(r.stderr, /kept changing/);
    });
  });
}

describe("forge-specific record checks (R13)", () => {
  test("GitHub: an assignee the timeline cannot explain fails closed, without any write", async () => {
    const f = new FakeForge("github", { recordsCreation: false }).issue(7, "author", ["alice"]);
    expect(await pickup(f, "bob", 7), 2, null);
    assert.deepEqual(f.writes, []);
  });

  test("GitLab: an assignment note outside the grammar fails closed", async () => {
    const f = new FakeForge("gitlab").issue(7).human("alice", 7, { add: ["alice"] });
    f.rawNotes.push({
      id: 999,
      issue: 7,
      at: f.now + 1,
      author: "bob",
      body: "reassigned to @bob",
    });
    const r = await pickup(f, "alice", 7);
    expect(r, 2, null);
    assert.match(r.stderr, /unparsed GitLab assignment note/);
  });

  test("GitLab v2-F1: a missed intruder note is exit 2, never a withdrawal of the real owner", async () => {
    const f = new FakeForge("gitlab").issue(7).human("alice", 7, { add: ["alice"] });
    f.advance(5000).mutate(7, "bob", [{ user: "bob", op: "add" }], { recorded: false });
    expect(await pickup(f, "alice", 7), 2, null);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.assignees(7), ["alice", "bob"]);
  });

  test("Gitea before 1.27 writes with add-only / remove-only PATCHes, never a replacing one", async () => {
    const f = new FakeForge("gitea", { giteaVersion: "1.24.3" })
      .issue(7)
      .human("alice", 7, { add: ["alice"] });
    f.advance(5000).mutate(
      7,
      "bob",
      [
        { user: "alice", op: "remove" },
        { user: "bob", op: "add" },
      ],
      { agent: true },
    );
    expect(await pickup(f, "bob", 7), 3, "alice");
    assert.deepEqual(writesBy(f, "bob"), [
      "bob: PATCH assignees bob,alice",
      "bob: PATCH assignees alice",
    ]);
    neverFree(f);
  });
});

describe("usage and configuration (exit 1)", () => {
  const f = new FakeForge("github").issue(7);
  for (const argv of [
    [],
    ["--issue"],
    ["--issue", "0"],
    ["--issue", "x"],
    ["--issue", "7", "--force"],
  ])
    test(`rejects ${JSON.stringify(argv)}`, async () => {
      const { main } = await import("../lib/ticket-pickup.ts");
      const err: string[] = [];
      const code = await main(argv, {
        run: f.runAs("a"),
        env: {},
        remoteUrl: () => f.remoteUrl(),
        readConfig: () => null,
        sleep: async () => {},
        out: () => {},
        err: (l) => err.push(l),
      });
      assert.equal(code, 1);
      assert.match(err.join("\n"), /usage: ticket-pickup\.ts --issue <N>/);
    });

  test("a malformed org delay is a usage error, before any forge call", async () => {
    const g = new FakeForge("github").issue(7);
    const r = await pickup(g, "alice", 7, [], { readConfig: () => 'ticket_grace_days = "soon"' });
    assert.equal(r.code, 1);
    assert.deepEqual(g.calls, []);
  });
});

describe("two concurrent pickups of a free ticket, every interleaving (PLAN v2 step 6, v1-F4)", () => {
  const configs: [string, Make, boolean][] = [
    ["GitHub", (k) => new FakeForge("github", k), true],
    ["GitHub, replace-on-add", (k) => new FakeForge("github", { ...k, replaceOnAdd: true }), true],
    ["GitLab", (k) => new FakeForge("gitlab", k), true],
    [
      "GitLab single-assignee tier",
      (k) => new FakeForge("gitlab", { ...k, singleAssignee: true }),
      true,
    ],
    ["Gitea 1.27 (dedicated endpoints)", (k) => new FakeForge("gitea", k), true],
    // PLAN v2 Risks: a stale-read add-only PATCH acts as a replacing one (accepted lost-update race).
    [
      "Gitea 1.24 (PATCH only)",
      (k) => new FakeForge("gitea", { ...k, giteaVersion: "1.24.3" }),
      false,
    ],
  ];
  const matrix = [
    [0, 0],
    [0, 1500],
    [400, 0],
    [400, 1500],
  ] as const;
  for (const [name, make, repairsNeverFree] of configs)
    // The accepted-risk Gitea 1.24 path asserts the least and costs the most: one point of the matrix.
    for (const [callMs, lag] of repairsNeverFree ? matrix : matrix.slice(1, 2))
      test(`${name}: call cost ${callMs} ms, rival visible after ${lag} ms`, async () => {
        const runs = await exhaust(
          () => {
            const f = make({ lagFor: new Map([["bob", lag]]) }).issue(7);
            f.callMs = callMs;
            return f;
          },
          ["alice", "bob"],
          7,
          async ({ forge: f, results, trail }) => {
            const codes = results.map((r) => r.code);
            const ctx = `schedule [${trail}] exits ${codes.join("/")}: ${results.map((r) => r.stderr).join(" | ")}`;
            assert.ok(codes.filter((c) => c === 0).length <= 1, `two pickups proceeded: ${ctx}`);
            assert.ok(
              codes.every((c) => [0, 2, 3, 4, 5].includes(c)),
              ctx,
            );
            if (repairsNeverFree) neverFree(f);
            const truth = await pickup(f.advance(DAY), "observer", 7, ["--read-only"]);
            for (const r of results.filter((x) => x.code === 0))
              assert.equal(r.report.owner, truth.report.owner, `a non-owner proceeded: ${ctx}`);
            if (truth.code === 4) assert.ok(!codes.includes(0), `a tie exited 0: ${ctx}`);
            assert.ok(!codes.includes(5), `R14 without any refused assignment: ${ctx}`);
            const owner = results.findIndex((r) => r.report.self === truth.report.owner);
            if (truth.report.verdict === "owned-by-other" && owner >= 0)
              assert.equal(codes[owner], 0, `the first recorded taker did not proceed: ${ctx}`);
          },
        );
        assert.ok(runs > 1);
      });
});

// Regressions of two gaps the interleaving test found in the first cut of the tool.
describe("regressions: R11 restore after displacement, R14 lagged own write", () => {
  test("GitLab: the first taker displaced by a stale-read rival PUT restores itself and proceeds (R11)", async () => {
    const f = new FakeForge("gitlab").issue(7);
    f.afterWrite = (actor) => {
      if (actor !== "alice") return;
      f.afterWrite = null;
      // Bob's agent read #7 as free before Alice's write: its PUT replaces her.
      void f.runAs("bob")([
        "glab",
        "api",
        "--hostname",
        f.host(),
        "-X",
        "PUT",
        `projects/acme%2Ftools%2Fwidgets/issues/7?assignee_ids[]=${f.userId("bob")}`,
      ]);
    };
    const r = await pickup(f, "alice", 7);
    expect(r, 0, "alice");
    neverFree(f);
  });

  test("GitHub: an own assignment not yet visible in the current list is waited for, not reported as dropped (R14)", async () => {
    const f = new FakeForge("github", { lagFor: new Map([["alice", 1500]]) }).issue(7);
    const r = await pickup(f, "alice", 7);
    expect(r, 0, "alice");
    assert.equal(
      f.comments.length,
      0,
      "a maintainer was asked to assign an already-recorded assignment",
    );
  });
});

// Regressions of PR #1396 review pass 1 (seat review/1387, findings i1-F1..i1-F4).
describe("regressions: PR #1396 review pass 1", () => {
  for (const body of [
    "changed title from **Fix assignee menu** to **Fix assignee dropdown**",
    'added ~"needs-assignment" label',
    "changed the description to mention the reassignment policy",
  ])
    test(`i1-F1: a GitLab system note merely mentioning "assign" is ignored: ${body}`, async () => {
      const f = new FakeForge("gitlab").issue(7).human("alice", 7, { add: ["alice"] });
      f.rawNotes.push({ id: 900, issue: 7, at: f.now + 1, author: "carol", body });
      expect(await pickup(f.advance(1000), "bob", 7), 3, "alice");
      expect(await pickup(f, "alice", 7), 0, "alice");
    });

  test("i1-F1: the legacy `reassigned to @b` wording still fails closed", async () => {
    const f = new FakeForge("gitlab").issue(7).human("alice", 7, { add: ["alice"] });
    f.rawNotes.push({
      id: 901,
      issue: 7,
      at: f.now + 1,
      author: "bob",
      body: "reassigned to @bob",
    });
    expect(await pickup(f.advance(1000), "carol", 7), 2, null);
  });

  test("i1-F2: every tea call is bound to the repository's git remote", async () => {
    const f = new FakeForge("gitea").issue(7);
    const r = await pickup(f, "alice", 7, [], { remoteName: () => "upstream" });
    expect(r, 0, "alice");
    const tea = f.calls.map((c) => c.slice("alice: ".length).split(" "));
    assert.ok(tea.length > 3);
    for (const argv of tea)
      assert.deepEqual(argv.slice(0, 4), ["tea", "api", "--remote", "upstream"], argv.join(" "));
  });

  test("i1-F3: a Gitea server page cap below 50 still reads the whole timeline", async () => {
    // True owner is bob: alice released, bob took, alice was added, bob left, never free since bob.
    const f = new FakeForge("gitea", { pageCap: 1 }).issue(7);
    f.human("alice", 7, { add: ["alice"] })
      .advance(1000)
      .human("alice", 7, { remove: ["alice"] });
    f.advance(1000)
      .human("bob", 7, { add: ["bob"] })
      .advance(1000)
      .human("alice", 7, { add: ["alice"] });
    f.advance(1000)
      .human("bob", 7, { remove: ["bob"] })
      .advance(1000);
    const r = await pickup(f, "carol", 7, ["--read-only"]);
    expect(r, 0, "bob");
    const g = new FakeForge("gitea", { pageCap: 20 }).issue(7);
    for (let i = 0; i < 45; i++) g.advance(1000).say("carol", 7, `note ${i}`);
    g.advance(1000).human("alice", 7, { add: ["alice"] });
    expect(await pickup(g, "bob", 7), 3, "alice");
  });

  test("i1-F4: at most one restoration per pickup when the first read already yields restore-self", async () => {
    const f = new FakeForge("github")
      .issue(7)
      .human("alice", 7, { add: ["alice"] })
      .advance(5000);
    f.human("bob", 7, { remove: ["alice"], add: ["bob"] }).advance(60_000);
    f.afterWrite = (actor) => {
      if (actor !== "alice") return;
      f.advance(1000).human("bob", 7, { remove: ["alice"] });
    };
    const r = await pickup(f, "alice", 7);
    expect(r, 2, "alice");
    assert.equal(
      writesBy(f, "alice").length,
      1,
      `restored more than once: ${writesBy(f, "alice").join("; ")}`,
    );
    assert.match(r.stderr, /displaced again/);
    neverFree(f);
  });
});

// Regressions of PR #1396 review pass 2 (seat review/1387, finding i2-F1): the
// legacy GitLab removal notes carry no username, so they must fail closed.
describe("regressions: PR #1396 review pass 2", () => {
  /** alice leaves (legacy note only), bob takes the free issue, alice is added then removed again. */
  function legacyHistory(body: string): FakeForge {
    const f = new FakeForge("gitlab")
      .issue(7)
      .human("alice", 7, { add: ["alice"] })
      .advance(1000);
    f.mutate(7, "alice", [{ user: "alice", op: "remove" }], { recorded: false });
    f.rawNotes.push({ id: 950, issue: 7, at: f.now, author: "alice", body });
    f.advance(1000)
      .human("bob", 7, { add: ["bob"] })
      .advance(1000);
    f.human("carol", 7, { add: ["alice"] })
      .advance(1000)
      .human("carol", 7, { remove: ["alice"] });
    return f.advance(1000);
  }

  test("i2-F1: a label removal mentioning assignees stays ignored (the widened guard is not a substring match)", async () => {
    const f = new FakeForge("gitlab").issue(7).human("alice", 7, { add: ["alice"] });
    f.rawNotes.push({
      id: 951,
      issue: 7,
      at: f.now + 1,
      author: "carol",
      body: 'removed ~"assignee-needed" label',
    });
    expect(await pickup(f.advance(1000), "bob", 7), 3, "alice");
  });

  test("i2-F1: a capitalised `Assigned to @a` is outside the case-sensitive grammar and fails closed", async () => {
    const f = new FakeForge("gitlab").issue(7).human("alice", 7, { add: ["alice"] });
    f.rawNotes.push({ id: 952, issue: 7, at: f.now + 1, author: "bob", body: "Assigned to @bob" });
    expect(await pickup(f.advance(1000), "carol", 7), 2, null);
    assert.deepEqual(f.writes, []);
  });

  for (const body of ["removed assignee", "Removed assignee", "removed all assignees"])
    test(`i2-F1: the legacy note '${body}' fails closed and the rightful owner is never withdrawn`, async () => {
      const f = legacyHistory(body);
      assert.deepEqual(f.assignees(7), ["bob"]);
      const view = await pickup(f, "carol", 7, ["--read-only"]);
      expect(view, 2, null);
      assert.match(view.stderr, /unparsed GitLab assignment note/);
      expect(await pickup(f, "bob", 7), 2, null);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.assignees(7), ["bob"]);
    });
});
