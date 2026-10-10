// setup-retarget-others.test.ts — the pins of the static reads retargeted from the SHELL text of the
// four setups to their DECLARATION (spec 0256 requirement 9, plan v2 PR D1, brief letter c2). Each
// case reads the shell text AND the declaration and asserts they agree, so the Bash suites that now
// read the declaration only stay honest against the unchanged shell while it exists. Retired with the
// shell (PR E). The cases are named by the phrase the retargeted Bash suites cite in their comments.
//
// Suites served: test-setup-validation-backend.sh (4), test-tls-delegation.sh (6),
// test-setup-ensure-tier-built.sh (4), test-setup-org-mcp.sh (6), test-setup-gemini-settings-merge.sh
// (13), test-setup-init-command-instructions.sh (1), test-system-context-store.sh (4),
// test-mempalace-doctor.sh (9), test-antigravity-component-install.sh (13).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { SETUP_DESCRIPTORS } from "./lib/print-setup-declarations.ts";
import { declarationFacts } from "./lib/setup-declarations-facts.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;
type CliName = (typeof CLIS)[number];

function shell(cli: CliName): string {
  return fs.readFileSync(path.join(REPO, "scripts", `setup-${cli}-interactive.sh`), "utf8");
}
const COMMON = fs.readFileSync(path.join(REPO, "scripts", "lib", "common.sh"), "utf8");

/** The non-comment lines of a shell text, numbered from 1. */
function code(text: string): Array<[number, string]> {
  return text
    .split("\n")
    .map((l, i): [number, string] => [i + 1, l])
    .filter(([, l]) => !/^\s*#/.test(l));
}
/** The 1-based line of the first non-comment line matching `re`, or 0. */
function lineOf(text: string, re: RegExp): number {
  const hit = code(text).find(([, l]) => re.test(l));
  return hit === undefined ? 0 : hit[0];
}

interface Declared {
  readonly steps: string[];
  readonly facts: Map<string, string>;
}
function declared(cli: CliName): Declared {
  const d = SETUP_DESCRIPTORS[cli];
  assert.ok(d !== undefined && d.steps.length > 0, `${cli}: a non-empty descriptor`);
  return { steps: [...d.steps], facts: new Map(declarationFacts(d)) };
}
function fact(cli: CliName, key: string): string {
  const v = declared(cli).facts.get(key);
  assert.ok(v !== undefined && v !== "", `${cli}: the declaration carries ${key}`);
  return v;
}
function substeps(cli: CliName): string[] {
  return fact(cli, "substeps.mcp").split(",");
}

describe("the validation backend is configured by the rules-shared step", () => {
  for (const cli of CLIS) {
    it(`${cli}: the shell calls configure_validation_backend and the declaration asks it in rules-shared`, () => {
      assert.ok(
        lineOf(shell(cli), /\bconfigure_validation_backend\b/) > 0,
        "the shell call exists",
      );
      assert.ok(declared(cli).steps.includes("rules-shared"));
      assert.match(fact(cli, "prompts.rules-shared"), /(^|,)validation\.backend(,|$)/);
    });
  }
});

describe("the TLS offer is invoked by the tls-offer step", () => {
  for (const cli of CLIS) {
    it(`${cli}: the shell calls offer_tls_delegation and the declaration has the tls-offer step`, () => {
      assert.ok(lineOf(shell(cli), /\boffer_tls_delegation\b/) > 0, "the shell call exists");
      assert.ok(declared(cli).steps.includes("tls-offer"));
      assert.equal(fact(cli, "prompts.tls-offer"), "tls-delegation");
    });
  }
});

/** The `local staging="..."` of the tier-install function the setup calls for its library tier. */
function installStaging(cli: CliName): string {
  const text =
    cli === "antigravity"
      ? (/^install_antigravity_tier_to_home\(\)[\s\S]*?local staging="([^"]*)"/m.exec(COMMON) ??
          [])[1]
      : (/local staging="([^"]*)"/.exec(shell(cli)) ?? [])[1];
  assert.ok(text !== undefined, `${cli}: the tier-install function names its staging path`);
  return text.replace("$tier", "library").replace("$repo_dir", "$REPO_DIR");
}

describe("ensure_tier_built build target and staging equal the declared ones", () => {
  for (const cli of CLIS) {
    it(`${cli}: the shell call, the install function and the declaration agree`, () => {
      const call = /ensure_tier_built "\$REPO_DIR" ([A-Za-z0-9_]+) "([^"]*)"/.exec(shell(cli));
      assert.ok(call !== null, "the shell has the ensure_tier_built call");
      assert.equal(call[1], fact(cli, "tiers.build-target"));
      const gate = fact(cli, "tiers.gate")
        .replace("<TIER>", "library")
        .replace("<REPO>", "$REPO_DIR");
      assert.equal(call[2], gate, "the ensure_tier_built staging argument is the declared gate");
      assert.equal(installStaging(cli), gate, "the install function reads the same path");
      assert.ok(gate.startsWith(fact(cli, "tiers.library-staging").replace("<REPO>", "$REPO_DIR")));
    });
  }
});

describe("org fold per CLI: the shell calls and their order equal the declared sub-steps", () => {
  for (const cli of ["copilot", "antigravity"] as const) {
    it(`${cli}: translate, then fold after the 0089 merge, declared as write-mcp-config then org-mcp-fold`, () => {
      const text = shell(cli);
      const merge = lineOf(text, /merge_preexisting_mcp_servers "/);
      const translate = lineOf(text, new RegExp(`org_mcp_to_native ${cli}\\b`));
      const fold = lineOf(text, /apply_org_mcp_servers "/);
      assert.ok(
        merge > 0 && translate > merge && fold > translate,
        `${merge} < ${translate} < ${fold}`,
      );
      const subs = substeps(cli);
      assert.ok(subs.indexOf("write-mcp-config") >= 0);
      assert.ok(subs.indexOf("org-mcp-fold") > subs.indexOf("write-mcp-config"));
    });
  }
  it("gemini: org_mcp_to_native precedes gemini_settings_write, which receives ORG_MCP_NATIVE", () => {
    const text = shell("gemini");
    const translate = lineOf(text, /org_mcp_to_native gemini\b/);
    const write = lineOf(text, /^\s*gemini_settings_write\s.*"\$ORG_MCP_NATIVE"/);
    assert.ok(translate > 0 && write > translate, `${translate} < ${write}`);
    const subs = substeps("gemini");
    assert.ok(subs.indexOf("org-mcp-read") >= 0);
    assert.ok(subs.indexOf("gemini-settings-write") > subs.indexOf("org-mcp-read"));
  });
  it("claude: register_org_mcp_claude follows the ensure_mempalace_http registration", () => {
    const text = shell("claude");
    const http = lineOf(text, /ensure_mempalace_http "\$REPO_DIR" claude/);
    const org = lineOf(text, /register_org_mcp_claude /);
    assert.ok(http > 0 && org > http, `${http} < ${org}`);
    const subs = substeps("claude");
    assert.ok(subs.indexOf("register-stdio-fallback") >= 0);
    assert.ok(subs.indexOf("org-mcp-fold") > subs.indexOf("register-stdio-fallback"));
    assert.ok(subs.indexOf("org-mcp-fold") > subs.indexOf("ensure-mempalace-http"));
  });
});

describe("gemini_settings_write precedes ensure_mempalace_http, session recording and usage capture", () => {
  it("the shell order equals the declared order", () => {
    const text = shell("gemini");
    const write = lineOf(text, /^\s*gemini_settings_write\s/);
    const http = lineOf(text, /^\s*ensure_mempalace_http\s/);
    const session = lineOf(text, /merge_session_recording_hooks gemini/);
    const usage = lineOf(text, /usage_capture_state gemini/);
    assert.ok(write > 0 && write < http && write < session && write < usage);
    const subs = substeps("gemini");
    assert.ok(subs.indexOf("gemini-settings-write") >= 0);
    assert.ok(subs.indexOf("gemini-settings-write") < subs.indexOf("ensure-mempalace-http"));
    const { steps } = declared("gemini");
    assert.ok(steps.indexOf("mcp") < steps.indexOf("session-recording"));
    assert.ok(steps.indexOf("mcp") < steps.indexOf("usage-capture"));
  });
});

describe("the init-command string per CLI", () => {
  /** The shell's `run: <format>` text, `$skill` unexpanded and quotes escaped as in the source. */
  const SHELL_FORMAT: Record<CliName, string> = {
    claude: "run: claude $skill",
    gemini: "run: gemini $skill",
    copilot: 'run: copilot -i \\"$skill\\"',
    antigravity: 'run: agy -i \\"$skill\\" --new-project',
  };
  for (const cli of CLIS) {
    it(`${cli}: the shell formats check_finalized with the invocation the declaration names`, () => {
      assert.ok(shell(cli).includes(SHELL_FORMAT[cli]), `the shell carries ${SHELL_FORMAT[cli]}`);
      const invocation = SHELL_FORMAT[cli].slice("run: ".length).replace(/\\"/g, '"');
      for (const [key, skill] of [
        ["init.soul", "/init-soul"],
        ["init.profile", "/init-personal-profile"],
      ] as const) {
        assert.equal(fact(cli, key), invocation.replace("$skill", skill));
      }
    });
  }
});

describe("storeGuidance is true exactly where the shell calls print_store_access_guidance", () => {
  for (const cli of CLIS) {
    it(`${cli}: the call and the flag agree`, () => {
      const calls = lineOf(shell(cli), /^\s*print_store_access_guidance\s/) > 0;
      assert.equal(fact(cli, "store-guidance"), String(calls));
    });
  }
  it("the flag is true on gemini and copilot only", () => {
    assert.deepEqual(
      CLIS.filter((c) => fact(c, "store-guidance") === "true"),
      ["gemini", "copilot"],
    );
  });
});

describe("the launcher path per CLI: the shell names the wrapper once iff the declaration says setup", () => {
  const wrapper = "scripts/lib/mempalace-http-wrapper.py";
  for (const cli of CLIS) {
    it(`${cli}: ${wrapper} count in the shell matches the declared carrier`, () => {
      const count = shell(cli).split(wrapper).length - 1;
      const carrier = fact(cli, "mcp.wrapper-carrier");
      assert.match(fact(cli, "mcp.wrapper-script"), /\/scripts\/lib\/mempalace-http-wrapper\.py$/);
      if (carrier === "setup") {
        assert.equal(count, 1);
      } else {
        assert.equal(count, 0, "the path lives in the committed template, not the setup");
        const file = fs.readFileSync(path.join(REPO, carrier), "utf8");
        assert.equal(file.split(wrapper).length - 1, 1, `${carrier} names the wrapper once`);
      }
    });
  }
});

describe("the Antigravity homes", () => {
  it("the shell assignments equal the declared roots and the migration is its own step after tiers", () => {
    const text = shell("antigravity");
    const home = (v: string): string => `<HOME>/${v}`;
    for (const [variable, key, tail] of [
      ["AGY_SKILLS_HOME", "home.skills", ".gemini/config/skills"],
      ["AGY_AGENTS_HOME", "home.agents", ".gemini/config/agents"],
      ["AGY_HOME", "home.cli", ".gemini/antigravity-cli"],
    ] as const) {
      assert.ok(text.includes(`${variable}="\${HOME}/${tail}"`), `${variable} in the shell`);
      assert.equal(fact("antigravity", key), home(tail));
    }
    const { steps } = declared("antigravity");
    assert.ok(steps.indexOf("migrate-superseded") > steps.indexOf("tiers"));
    assert.equal(fact("antigravity", "tiers.migrates-superseded"), "true");
    // In the shell the migration call follows the end of the overlay loop (it is not gated on it).
    const lines = text.split("\n");
    const loopEnd = lines.findIndex(
      (l, i) => i > lines.findIndex((x) => /^for overlay_tier in/.test(x)) && l === "done",
    );
    assert.ok(lineOf(text, /^migrate_antigravity_superseded_components/) > loopEnd + 1);
  });
});
