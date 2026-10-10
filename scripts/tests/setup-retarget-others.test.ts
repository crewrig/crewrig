// setup-retarget-others.test.ts — the pins of the setup DECLARATION that the Bash suites cite in
// their comments (spec 0256 requirement 9). The suites read the declaration of the four setups; the
// shell text they once compared against is a forwarding shim now, so each case asserts the
// declaration alone: its steps, prompts, sub-step order and literal facts. The cases are named by the
// phrase the retargeted Bash suites cite in their comments.
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
    it(`${cli}: the declaration asks validation.backend in rules-shared`, () => {
      assert.ok(declared(cli).steps.includes("rules-shared"));
      assert.match(fact(cli, "prompts.rules-shared"), /(^|,)validation\.backend(,|$)/);
    });
  }
});

describe("the TLS offer is invoked by the tls-offer step", () => {
  for (const cli of CLIS) {
    it(`${cli}: the declaration has the tls-offer step asking tls-delegation`, () => {
      assert.ok(declared(cli).steps.includes("tls-offer"));
      assert.equal(fact(cli, "prompts.tls-offer"), "tls-delegation");
    });
  }
});

describe("ensure_tier_built build target and staging are the declared ones", () => {
  for (const cli of CLIS) {
    it(`${cli}: the declared build target names a task and the gate lives under the library staging`, () => {
      assert.match(fact(cli, "tiers.build-target"), /^[A-Za-z0-9_]+$/);
      const gate = fact(cli, "tiers.gate")
        .replace("<TIER>", "library")
        .replace("<REPO>", "$REPO_DIR");
      assert.ok(gate.startsWith(fact(cli, "tiers.library-staging").replace("<REPO>", "$REPO_DIR")));
    });
  }
});

describe("org fold per CLI: the declared sub-steps are in the order of the fold", () => {
  for (const cli of ["copilot", "antigravity"] as const) {
    it(`${cli}: write-mcp-config precedes org-mcp-fold`, () => {
      const subs = substeps(cli);
      assert.ok(subs.indexOf("write-mcp-config") >= 0);
      assert.ok(subs.indexOf("org-mcp-fold") > subs.indexOf("write-mcp-config"));
    });
  }
  it("gemini: org-mcp-read precedes gemini-settings-write", () => {
    const subs = substeps("gemini");
    assert.ok(subs.indexOf("org-mcp-read") >= 0);
    assert.ok(subs.indexOf("gemini-settings-write") > subs.indexOf("org-mcp-read"));
  });
  it("claude: org-mcp-fold follows the stdio fallback and the ensure-mempalace-http registration", () => {
    const subs = substeps("claude");
    assert.ok(subs.indexOf("register-stdio-fallback") >= 0);
    assert.ok(subs.indexOf("org-mcp-fold") > subs.indexOf("register-stdio-fallback"));
    assert.ok(subs.indexOf("org-mcp-fold") > subs.indexOf("ensure-mempalace-http"));
  });
});

describe("gemini-settings-write precedes ensure-mempalace-http, session recording and usage capture", () => {
  it("the declared order puts the settings write first", () => {
    const subs = substeps("gemini");
    assert.ok(subs.indexOf("gemini-settings-write") >= 0);
    assert.ok(subs.indexOf("gemini-settings-write") < subs.indexOf("ensure-mempalace-http"));
    const { steps } = declared("gemini");
    assert.ok(steps.indexOf("mcp") < steps.indexOf("session-recording"));
    assert.ok(steps.indexOf("mcp") < steps.indexOf("usage-capture"));
  });
});

describe("the init-command string per CLI", () => {
  /** The invocation each CLI's finalize hint names, `$skill` unexpanded. */
  const INVOCATION: Record<CliName, string> = {
    claude: "claude $skill",
    gemini: "gemini $skill",
    copilot: 'copilot -i "$skill"',
    antigravity: 'agy -i "$skill" --new-project',
  };
  for (const cli of CLIS) {
    it(`${cli}: the declaration names ${INVOCATION[cli]} for both init skills`, () => {
      for (const [key, skill] of [
        ["init.soul", "/init-soul"],
        ["init.profile", "/init-personal-profile"],
      ] as const) {
        assert.equal(fact(cli, key), INVOCATION[cli].replace("$skill", skill));
      }
    });
  }
});

describe("storeGuidance is declared true on gemini and copilot only", () => {
  it("the flag is true on gemini and copilot only", () => {
    assert.deepEqual(
      CLIS.filter((c) => fact(c, "store-guidance") === "true"),
      ["gemini", "copilot"],
    );
  });
});

describe("the launcher path per CLI: the declared carrier of the MemPalace wrapper", () => {
  const wrapper = "scripts/lib/mempalace-http-wrapper.py";
  for (const cli of CLIS) {
    it(`${cli}: ${wrapper} is the declared wrapper script and its carrier is setup or a template naming it once`, () => {
      const carrier = fact(cli, "mcp.wrapper-carrier");
      assert.match(fact(cli, "mcp.wrapper-script"), /\/scripts\/lib\/mempalace-http-wrapper\.py$/);
      if (carrier !== "setup") {
        const file = fs.readFileSync(path.join(REPO, carrier), "utf8");
        assert.equal(file.split(wrapper).length - 1, 1, `${carrier} names the wrapper once`);
      }
    });
  }
});

describe("the Antigravity homes", () => {
  it("the declared roots are the Antigravity homes and the migration is its own step after tiers", () => {
    const home = (v: string): string => `<HOME>/${v}`;
    for (const [key, tail] of [
      ["home.skills", ".gemini/config/skills"],
      ["home.agents", ".gemini/config/agents"],
      ["home.cli", ".gemini/antigravity-cli"],
    ] as const) {
      assert.equal(fact("antigravity", key), home(tail));
    }
    const { steps } = declared("antigravity");
    assert.ok(steps.indexOf("migrate-superseded") > steps.indexOf("tiers"));
    assert.equal(fact("antigravity", "tiers.migrates-superseded"), "true");
  });
});
