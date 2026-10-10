// setup-retarget-antigravity-transcript.test.ts - the BEHAVIOUR that scripts/tests/test-setup-antigravity-transcript.sh
// used to read from the TEXT of scripts/setup-antigravity-interactive.sh, now observed by RUNNING the
// TypeScript entry (scripts/setup-antigravity-interactive.ts) in the golden sandbox (spec 0256
// requirement 9, PR D2). Each case runs a golden cell; its pin against the unchanged shell is the golden
// cell of the same id under scripts/tests/fixtures/setup-golden/antigravity/ (checked on both legs by
// setup-golden-antigravity.test.ts). Retired with the shell at the switch PR only if the golden cells stay.
//
// Replaces, in the shell suite:
//   R22  consent text greps                         -> "R22" test (disclosure printed by the run)
//   R16  gate block extracted from the shell + run  -> "R16" tests (offer no / no+yes / Apply? declined / accepted)
//   R24  call-site argument mutations               -> "R24" test (the landed manifest carries each argument)
//   §6   statusline greps (previous key, 0600 atomic writer without .tmp, shim never copied) -> "statusline" tests
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, test } from "node:test";

import { realHomeGuard } from "./lib/real-home-guard.ts";
import { casesFor } from "./lib/setup-golden-all.ts";
import { runSetupCase } from "./lib/setup-golden-run.ts";
import type { CaseResult } from "./lib/setup-golden-run.ts";
import type { GoldenCase } from "./lib/setup-golden-types.ts";
import type { SetupSandbox } from "./lib/setup-sandbox.ts";
import { hasJq } from "./lib/setup-stubs.ts";

const skip =
  process.platform !== "linux"
    ? "the setup golden harness runs on Linux only"
    : hasJq()
      ? undefined
      : "a real jq is required";

const HOOKS = ".gemini/config/hooks.json";
const SETTINGS = ".gemini/antigravity-cli/settings.json";
const MARKER = ".crewrig/usage/state/antigravity-statusline.json";

interface Run {
  readonly result: CaseResult;
  readonly repo: string;
  readonly home: string;
  /** Contents of the requested files under the sandbox home at the end of the run (absent: undefined). */
  readonly files: ReadonlyMap<string, string | undefined>;
  readonly modes: ReadonlyMap<string, string>;
  /** Every file path under the sandbox home, relative, at the end of the run. */
  readonly listing: readonly string[];
}

function walk(dir: string, base: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, base, out);
    else out.push(path.relative(base, abs));
  }
}

/** Run a golden case on the TypeScript leg and capture the files it left, before the sandbox is removed. */
async function run(c: GoldenCase, rels: readonly string[]): Promise<Run> {
  let captured: Omit<Run, "result"> | undefined;
  const wrapped: GoldenCase = {
    ...c,
    seed: (sb: SetupSandbox) => {
      c.seed?.(sb);
      const dispose = sb.dispose;
      (sb as { dispose: () => void }).dispose = () => {
        const files = new Map<string, string | undefined>();
        const modes = new Map<string, string>();
        for (const rel of rels) {
          const abs = path.join(sb.home, rel);
          files.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : undefined);
          if (fs.existsSync(abs)) modes.set(rel, (fs.statSync(abs).mode & 0o777).toString(8));
        }
        const listing: string[] = [];
        walk(sb.home, sb.home, listing);
        captured = {
          repo: fs.realpathSync(sb.repo),
          home: fs.realpathSync(sb.home),
          files,
          modes,
          listing,
        };
        dispose();
      };
    },
  };
  const result = await runSetupCase(wrapped, "ts");
  assert.ok(captured, "the sandbox was captured before disposal");
  return { result, ...captured };
}

const cell = (id: string): GoldenCase => {
  const found = casesFor("antigravity").find((c) => c.id === id);
  assert.ok(found, `golden cell ${id} exists`);
  return found;
};
const withFzf = (id: string, fzf: Record<string, string>, as: string): GoldenCase => {
  const base = cell(id);
  return { ...base, id: as, stubs: { ...base.stubs, fzf: { ...base.stubs?.fzf, ...fzf } } };
};
// The TypeScript leg takes its answers from `--answer`, so the fzf stub records nothing: what a run asked
// or decided is read from what it printed.
const printed = (r: Run, text: string): boolean => r.result.stdout.includes(text);
const json = (r: Run, rel: string): Record<string, unknown> =>
  JSON.parse(r.files.get(rel) ?? "null") as Record<string, unknown>;
const commandsOf = (hook: unknown): string[] => {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (typeof v === "object" && v !== null)
      for (const [k, x] of Object.entries(v)) {
        if (k === "command" && typeof x === "string") out.push(x);
        else visit(x);
      }
  };
  visit(hook);
  return out;
};

describe(
  "antigravity transcript opt-in, observed by running the TypeScript entry",
  { skip },
  () => {
    let guard: ReturnType<typeof realHomeGuard> | undefined;
    before(() => {
      guard = realHomeGuard();
    });

    test("R22 + R24 + R16 accepted: the consent text, the landed manifest (the call-site arguments) and the gate", async () => {
      // pin: golden antigravity/transcript-optin-yes
      const r = await run(cell("transcript-optin-yes"), [HOOKS]);
      try {
        // vacuity guard: the run succeeded and the manifest landed
        assert.equal(r.result.status, 0, r.result.stderr);
        assert.ok(r.files.get(HOOKS) !== undefined, "hooks.json landed");
        // R22: the consent text states the true write volume
        const out = r.result.stdout;
        assert.match(out, /Activating transcript hooks will:/);
        assert.ok(out.includes("Record ONE entry each time the agent's execution loop ends"));
        assert.doesNotMatch(out, /turn start and turn end/);
        // R16 canary: accepting both prompts reaches the deployment, and "Apply?" was asked
        assert.ok(printed(r, "Activating transcript hooks will:")); // offer yes, then Apply? reached
        assert.ok(printed(r, "Session recording wired to <REPO>/hooks/mempalace-transcript.ts"));
        const hooks = json(r, HOOKS);
        const transcript = hooks["crewrig-mempalace-transcript"];
        assert.ok(transcript !== undefined, "the transcript hook is deployed");
        // R24 arg 1 (manifest source) and arg 6 (guard source): both named hooks come from the shipped manifest
        assert.ok("crewrig-worktree-git-guard" in hooks);
        assert.deepEqual(Object.keys(transcript as object), ["Stop"]);
        const guard1 = commandsOf(hooks["crewrig-worktree-git-guard"]);
        assert.ok(
          guard1.length > 0 &&
            guard1.every((c) => c.includes(`${r.repo}/hooks/worktree-git-guard.ts`)),
        );
        assert.ok(
          guard1.every(
            (c) => !c.includes("MEMPALACE_TRANSCRIPT_ENABLED") && !/ (Stop|PreToolUse)$/.test(c),
          ),
        );
        // R24 arg 5 (env prefix empty) and R14: the direct form by absolute in-repo path, no env prefix, no $PWD
        const cmds = commandsOf(transcript);
        assert.ok(cmds.length > 0);
        for (const c of cmds) {
          assert.ok(
            c.startsWith(`node "${r.repo}/hooks/mempalace-transcript.ts" antigravity-cli `),
            c,
          );
          assert.ok(!c.includes("MEMPALACE_TRANSCRIPT_ENABLED") && !c.includes("$PWD"), c);
        }
        // R24 args 2/3 (hook copy retired) and arg 4 (target at the customization root, 0600)
        assert.ok(!r.listing.includes(".gemini/antigravity-cli/hooks/mempalace-transcript.sh"));
        assert.equal(r.modes.get(HOOKS), "600");
      } finally {
        guard?.assertUnchanged();
      }
    });

    test("R16 declined: the offer (no), the offer decline holding against Apply? yes, and Apply? declined deploy nothing", async () => {
      // pins: golden antigravity/transcript-optin-no, transcript-optin-yes-declined
      const cases: [GoldenCase, string][] = [
        [cell("transcript-optin-no"), "offer no"],
        [
          withFzf("transcript-optin-no", { "Apply?": "yes" }, "offer-no-apply-yes"),
          "offer no, Apply? yes",
        ],
        [cell("transcript-optin-yes-declined"), "Apply? no"],
      ];
      for (const [c, label] of cases) {
        const r = await run(c, [HOOKS]);
        try {
          assert.equal(r.result.status, 0, `${label}: ${r.result.stderr}`); // vacuity: the run completed
          const hooks = r.files.get(HOOKS) === undefined ? {} : json(r, HOOKS);
          assert.ok(!("crewrig-mempalace-transcript" in hooks), `${label}: nothing deployed`);
          assert.doesNotMatch(
            r.result.stdout,
            /Transcript hooks deployed|Session recording wired to/,
          );
          if (label === "Apply? no")
            assert.match(r.result.stdout, /Transcript activation canceled\./);
          else {
            assert.ok(
              printed(r, "Session recording disabled"),
              `${label}: the decline is reported`,
            );
            assert.ok(
              !printed(r, "Activating transcript hooks will:"),
              `${label}: Apply? never asked`,
            );
          }
        } finally {
          guard?.assertUnchanged();
        }
      }
    });

    test("statusline: absent + yes installs by in-repo path through the 0600 atomic writer, no .tmp left, shim never copied", async () => {
      // pin: golden antigravity/usage-capture-absent-yes
      const r = await run(cell("usage-capture-absent-yes"), [SETTINGS, MARKER]);
      try {
        assert.equal(r.result.status, 0, r.result.stderr);
        const direct = `node "${r.repo}/hooks/antigravity-statusline-shim.ts"`;
        const settings = json(r, SETTINGS) as { statusLine?: { command?: string } };
        assert.equal(settings.statusLine?.command, direct); // vacuity: the install landed
        assert.equal(
          (json(r, MARKER) as { installedStatusLineCommand?: string }).installedStatusLineCommand,
          direct,
        );
        assert.equal(r.modes.get(SETTINGS), "600");
        assert.equal(r.modes.get(MARKER), "600");
        assert.deepEqual(
          r.listing.filter((f) => f.endsWith(".tmp") || f.includes(".tmp.")),
          [],
        );
        assert.deepEqual(
          r.listing.filter((f) => f.includes("antigravity-statusline-shim")),
          [],
        );
      } finally {
        guard?.assertUnchanged();
      }
    });

    test("statusline: remove restores the prior command, also from the transitional previousInstalledStatusLineCommand state", async () => {
      // pin: golden antigravity/usage-capture-installed-remove (the plain state); the transitional state is only here
      const plain = await run(cell("usage-capture-installed-remove"), [SETTINGS, MARKER]);
      try {
        assert.equal(plain.result.status, 0, plain.result.stderr);
        assert.ok(printed(plain, "Antigravity usage capture is installed"));
        assert.equal(
          (json(plain, SETTINGS) as { statusLine: { command: string } }).statusLine.command,
          "prior-cmd",
        );
        assert.equal(plain.files.get(MARKER), undefined);
        assert.deepEqual(
          plain.listing.filter((f) => f.endsWith(".tmp") || f.includes(".tmp.")),
          [],
        );
      } finally {
        guard?.assertUnchanged();
      }
      const old = 'node "/opt/old/hooks/antigravity-statusline-shim.ts"';
      const transitional: GoldenCase = {
        ...cell("usage-capture-installed-remove"),
        id: "installed-remove-transitional",
        seed: (sb) => {
          const put = (rel: string, v: unknown): void => {
            fs.mkdirSync(path.dirname(path.join(sb.home, rel)), { recursive: true });
            fs.writeFileSync(path.join(sb.home, rel), JSON.stringify(v));
          };
          put(SETTINGS, { statusLine: { command: old } });
          // the settings still hold the OLD command: only the transitional key names it
          put(MARKER, {
            installedStatusLineCommand: "node /new/shim.ts",
            previousInstalledStatusLineCommand: old,
            priorStatusLineCommand: "prior-cmd",
          });
        },
      };
      const t = await run(transitional, [SETTINGS, MARKER]);
      try {
        assert.equal(t.result.status, 0, t.result.stderr);
        assert.ok(
          printed(t, "Antigravity usage capture is installed"),
          "recognised as the framework's",
        );
        assert.equal(
          (json(t, SETTINGS) as { statusLine: { command: string } }).statusLine.command,
          "prior-cmd",
        );
        assert.equal(t.files.get(MARKER), undefined);
      } finally {
        guard?.assertUnchanged();
      }
    });
  },
);
