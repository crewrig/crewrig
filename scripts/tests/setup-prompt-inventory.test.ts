// setup-prompt-inventory.test.ts — the prompt inventory derived from the SHELL setups (spec 0256
// requirement 12, plan v2 step A8). Every question the four shell setups ask is recorded by the
// stub `fzf` (header, option list in order) across a few scenarios; the observed set is asserted
// against the R12 table row by row (id, options, setups, cancel class) with no question outside it
// and no row never observed, and written to `fixtures/setup-golden/prompt-inventory.json.golden`
// (the single source of the TypeScript prompt-table test). Linux only, needs `jq`; shell leg only,
// always inside the sandbox. `SETUP_GOLDEN_REGEN=1` writes the table to `SETUP_GOLDEN_OUT`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { realHomeGuard } from "./lib/real-home-guard.ts";
import { runSetupCase } from "./lib/setup-golden-run.ts";
import type { CaseResult } from "./lib/setup-golden-run.ts";
import { R12 } from "./lib/setup-prompt-inventory-r12.ts";
import type { Cancel, Row } from "./lib/setup-prompt-inventory-r12.ts";
import { ASKED, NOT } from "./lib/setup-prompt-inventory-conditions.ts";
import { CLIS, cancelKey, idOfHeader, scenariosFor } from "./lib/setup-prompt-inventory-cases.ts";
import type { Cli } from "./lib/setup-golden-types.ts";
import { CANCEL, hasJq } from "./lib/setup-stubs.ts";

type Seen = { header: string; options: readonly string[]; scenario: string };

const cancelOf = (r: Row, cli: Cli): Cancel | undefined =>
  typeof r.cancel === "string" ? r.cancel : r.cancel[cli];

/** Where each scenario observed what: id -> cli -> first sighting. */
const seen = new Map<string, Map<Cli, Seen>>();
/** The classification per `<cli>/<id>`. */
const classes = new Map<string, Cancel>();
const unknown: string[] = [];
/** The scenarios each question was asked in: id -> cli -> scenario names. */
const askedIn = new Map<string, Map<Cli, Set<string>>>();
/** The witness per `<cli>/<scenario>`: the run exited 0 and asked at least one question. */
const ran = new Set<string>();
const linkResults = new Map<Cli, { n: CaseResult; y: CaseResult; eof: CaseResult }>();

const FIXTURE_DIR =
  process.env["SETUP_GOLDEN_DIR"] ?? path.join(REPO, "scripts/tests/fixtures/setup-golden");
const catalogue = (dir: string): string[] =>
  fs
    .readdirSync(path.join(REPO, dir))
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.slice(0, -3))
    .sort();

function record(cli: Cli, result: CaseResult, scenario: string): void {
  if (result.status === 0 && result.fzfRecords.length > 0) ran.add(`${cli}/${scenario}`);
  for (const r of result.fzfRecords) {
    const id = idOfHeader(r.header);
    if (id === undefined) {
      unknown.push(`${cli}/${scenario}: ${r.header}`);
      continue;
    }
    const byCli = askedIn.get(id) ?? new Map<Cli, Set<string>>();
    byCli.set(cli, (byCli.get(cli) ?? new Set<string>()).add(scenario));
    askedIn.set(id, byCli);
    const prior = seen.get(id)?.get(cli);
    if (prior !== undefined)
      assert.deepEqual(r.options, prior.options, `${cli}/${id} options differ across scenarios`);
    else
      seen.set(
        id,
        (seen.get(id) ?? new Map<Cli, Seen>()).set(cli, {
          header: r.header,
          options: r.options,
          scenario,
        }),
      );
  }
}

function classify(id: string, result: CaseResult, first: string): Cancel {
  assert.ok(
    result.fzfRecords.some((r) => r.cancelled && idOfHeader(r.header) === id),
    `the cancelled question ${id} was not asked`,
  );
  if (result.status === 130) return "abort";
  const key = id.startsWith("validation.") ? id.slice("validation.".length) : undefined;
  return key !== undefined && result.stdout.includes(`${key}=${first}`) ? "default" : "decline";
}

/** The one-key `--link` question is a `read -n 1`: observed through stdin, not through `fzf`. */
async function observeLink(cli: Cli): Promise<void> {
  const run = (stdin: string): Promise<CaseResult> =>
    runSetupCase(
      { cli, id: "inventory-link", note: "the one-key --link question", args: ["--link"], stdin },
      "shell",
    );
  linkResults.set(cli, { n: await run("n\n"), y: await run("y\n"), eof: await run("") });
}

async function observeAll(): Promise<void> {
  for (const cli of CLIS) {
    const scenarios = scenariosFor(cli);
    for (const s of scenarios) record(cli, await runSetupCase(s.c, "shell"), s.name);
    for (const [id, bySeen] of seen) {
      const here = bySeen.get(cli);
      if (here === undefined) continue;
      const home = id.startsWith("overlay.") ? `tier-${id.slice(8)}` : here.scenario;
      const scenario = scenarios.find((s) => s.name === home);
      assert.ok(scenario !== undefined, `no scenario ${home}`);
      const key = cancelKey(cli, here.header);
      const fzf = { ...scenario.c.stubs?.fzf, [key]: CANCEL };
      const result = await runSetupCase(
        { ...scenario.c, stubs: { ...scenario.c.stubs, fzf } },
        "shell",
      );
      classes.set(`${cli}/${id}`, classify(id, result, here.options[0] ?? ""));
    }
    await observeLink(cli);
  }
}

const linkAsking = (cli: Cli): boolean => {
  const l = linkResults.get(cli);
  return l !== undefined && l.n.status === 1 && `${l.n.stdout}${l.n.stderr}`.includes("Aborted");
};
const linkPrompt = (): string => {
  const src = fs.readFileSync(path.join(REPO, "scripts/setup-claude-interactive.sh"), "utf8");
  return /read -p "([^"]*)"/.exec(src)?.[1] ?? "";
};

function cancelMap(id: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of [...CLIS].sort()) {
    const v = classes.get(`${c}/${id}`);
    if (v !== undefined) out[c] = v;
  }
  return out;
}

/** The option list the shell offered (the same for every setup that asks); a catalogue row keeps its `@catalogue:<dir>` name. */
function observedOptions(r: Row): readonly string[] {
  const lists = [...(seen.get(r.id)?.values() ?? [])].map((s) => s.options);
  const first = lists[0] ?? [];
  for (const l of lists) assert.deepEqual(l, first, `${r.id}: the setups offer different options`);
  const dir = /^@catalogue:(.*)$/.exec(r.options[0] ?? "")?.[1];
  return dir !== undefined && JSON.stringify(first) === JSON.stringify(catalogue(dir))
    ? r.options
    : first;
}

const askedMap = (id: string): Record<string, string[]> =>
  Object.fromEntries(
    [...(askedIn.get(id) ?? [])].sort().map(([c, names]) => [c, [...names].sort()]),
  );

function table(): string {
  const rows = [
    ...R12.map((r) => ({
      id: r.id,
      header: Object.fromEntries([...(seen.get(r.id) ?? [])].sort().map(([c, s]) => [c, s.header])),
      options: observedOptions(r),
      clis: [...(seen.get(r.id)?.keys() ?? [])].sort(),
      condition: r.when,
      askedIn: askedMap(r.id),
      cancel: cancelMap(r.id),
    })),
    {
      id: "link-confirm",
      header: Object.fromEntries(
        CLIS.filter(linkAsking)
          .sort()
          .map((c) => [c, linkPrompt()]),
      ),
      options: ["no", "yes"],
      clis: CLIS.filter(linkAsking).sort(),
      condition: "--link is given (one key read, not fzf)",
      cancel: Object.fromEntries(
        CLIS.filter(linkAsking)
          .sort()
          .map((c) => [c, "none"]),
      ),
    },
  ];
  rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  return `${JSON.stringify(rows, null, 2)}\n`;
}

const skip =
  process.platform !== "linux" ? "Linux only" : !hasJq() ? "a real jq is required" : undefined;
describe("setup prompt inventory (shell oracle)", skip === undefined ? {} : { skip }, () => {
  const guard = skip === undefined ? realHomeGuard() : undefined;
  before(observeAll, { timeout: 1_800_000 });

  test("no question outside the inventory", () => {
    assert.deepEqual(unknown, []);
    guard?.assertUnchanged();
  });

  for (const r of R12) {
    test(`${r.id}: ids, options, setups, cancel class`, () => {
      const by = seen.get(r.id);
      assert.ok(by !== undefined, `${r.id} is never asked by any shell setup`);
      assert.deepEqual([...by.keys()].sort(), [...r.clis].sort());
      for (const [cli, s] of by) {
        const dir = /^@catalogue:(.*)$/.exec(r.options[0] ?? "")?.[1];
        assert.deepEqual(
          s.options,
          dir === undefined ? r.options : catalogue(dir),
          `${cli}/${r.id} options`,
        );
        assert.equal(
          classes.get(`${cli}/${r.id}`),
          cancelOf(r, cli),
          `${cli}/${r.id} cancel class`,
        );
        if (r.id.startsWith("validation.") === false)
          assert.notEqual(classes.get(`${cli}/${r.id}`), "default");
      }
    });
  }

  for (const r of R12) {
    test(`${r.id}: asked when its condition holds, not asked when it is false`, () => {
      for (const cli of r.clis) {
        const where = askedIn.get(r.id)?.get(cli) ?? new Set<string>();
        for (const name of ASKED[r.id] ?? [])
          assert.ok(where.has(name), `${cli}/${r.id} must be asked in ${name} (${r.when})`);
        for (const name of NOT[r.id] ?? []) {
          assert.ok(ran.has(`${cli}/${name}`), `${cli}/${name} did not run to its end (witness)`);
          assert.ok(!where.has(name), `${cli}/${r.id} must not be asked in ${name} (${r.when})`);
        }
      }
    });
  }

  test("link-confirm: asked by Claude, Gemini and Antigravity, not Copilot", () => {
    assert.deepEqual(CLIS.filter(linkAsking).sort(), ["antigravity", "claude", "gemini"]);
    for (const cli of CLIS.filter(linkAsking)) {
      const l = linkResults.get(cli);
      assert.ok(l !== undefined);
      assert.equal(l.eof.status, 1, `${cli}: end of input exits 1`);
      assert.ok(!`${l.y.stdout}${l.y.stderr}`.includes("Aborted"), `${cli}: y continues`);
    }
    assert.equal(linkPrompt(), "Continue with symlink mode? [y/N] ");
  });

  test("the observed table equals the committed golden", () => {
    const text = table();
    const name = "prompt-inventory.json.golden";
    if (process.env["SETUP_GOLDEN_REGEN"] === "1") {
      const out = process.env["SETUP_GOLDEN_OUT"] ?? FIXTURE_DIR;
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, name), text);
      return;
    }
    assert.equal(text, fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
  });
});
