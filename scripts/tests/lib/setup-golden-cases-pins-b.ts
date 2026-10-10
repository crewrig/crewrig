// setup-golden-cases-pins-b.ts — the PIN cells of the golden matrix for the Copilot and Antigravity
// shell setups (spec 0256 requirements 25-26 and the delta-01 deviations, plan v2 step A4b). Each
// cell observes a property the retargeted static-read suites (PR D1, D2) used to verify by reading
// the scripts' TEXT; the shell stays unchanged and every pin is guarded by the observable result.
import type { GoldenCase } from "./setup-golden-types.ts";

import {
  OPERATOR,
  SKILL,
  blankToken,
  both,
  cases as pinsB2,
  emptyCatalogues,
  home,
  json,
  lockHash,
  orgManifest,
  repoFile,
} from "./setup-golden-cases-pins-b2.ts";
import type { Seed } from "./setup-golden-cases-pins-b2.ts";

// ---------------------------------------------------------------- Copilot
const COP = "copilot" as const;
const COP_MCP = ".copilot/mcp-config.json";
const COP_HOOKS = ".copilot/hooks/copilot-transcript-hooks.json";
const COP_UC = 'bash "/opt/old/hooks/usage-capture.sh" copilot-cli sessionEnd';
const copHooksWithCapture = json({
  hooks: { sessionEnd: [{ type: "command", command: COP_UC }] },
});
const copStage: Seed = (sb) => {
  for (const tier of ["library", "community", "org"])
    repoFile(sb, `dist/${tier}/.github/skills/${tier}-skill/SKILL.md`, SKILL);
};
const UC_HDR = "Capture token usage for Copilot CLI?";
const UC_REG = "Usage capture is registered for Copilot CLI";

const copilot: GoldenCase[] = [
  {
    id: "operator-mcp-preserved",
    cli: COP,
    note: "R25/D1: the operator's MCP server is captured BEFORE the overwrite and merged back; the placeholder is kept literal.",
    seed: (sb) => home(sb, COP_MCP, json(OPERATOR)),
  },
  {
    id: "empty-catalogue-stale-markers",
    cli: COP,
    note: "R25/D1: an empty catalogue skips the pick and removes the stale .selected_* markers.",
    seed: both(emptyCatalogues, (sb) => {
      for (const m of ["level", "expertise", "team"])
        home(sb, `.copilot/.selected_${m}`, "STALE\n");
    }),
  },
  {
    id: "usage-capture-absent-yes",
    cli: COP,
    note: "D1 usage-capture state x answer: absent + yes registers the capture handler.",
    stubs: { fzf: { [UC_HDR]: "yes" } },
  },
  {
    id: "usage-capture-absent-no",
    cli: COP,
    note: "D1 usage-capture state x answer: absent + no registers nothing.",
    stubs: { fzf: { [UC_HDR]: "no" } },
  },
  {
    id: "usage-capture-installed-keep",
    cli: COP,
    note: "D1 usage-capture state x answer: installed + keep leaves the registration (re-pointed at this checkout).",
    seed: (sb) => home(sb, COP_HOOKS, copHooksWithCapture),
    stubs: { fzf: { [UC_REG]: "keep" } },
  },
  {
    id: "usage-capture-installed-remove",
    cli: COP,
    note: "D1 usage-capture state x answer: installed + remove strips the capture handler.",
    seed: (sb) => home(sb, COP_HOOKS, copHooksWithCapture),
    stubs: { fzf: { [UC_REG]: "remove" } },
  },
  {
    id: "usage-capture-unreadable-hooks",
    cli: COP,
    note: "D1 usage-capture: a hooks file that is not JSON skips the step with a warning.",
    seed: (sb) => home(sb, COP_HOOKS, "not json {\n"),
  },
  {
    id: "transcript-optin-no",
    cli: COP,
    note: "D1 transcript opt-in gate: no leaves the hooks file unwritten.",
    stubs: { fzf: { "Enable automatic session recording": "no" } },
  },
  {
    id: "transcript-optin-yes",
    cli: COP,
    note: "D1 transcript opt-in gate: yes + Apply? yes deploys the user-level hooks.",
    stubs: { fzf: { "Enable automatic session recording": "yes", "Apply?": "yes" } },
  },
  {
    id: "transcript-optin-yes-declined",
    cli: COP,
    note: "D1 transcript opt-in gate: yes + Apply? declined prints the cancellation and writes nothing.",
    stubs: { fzf: { "Enable automatic session recording": "yes", "Apply?": "no" } },
  },
  {
    id: "transcript-optin-all-hooks-disabled",
    cli: COP,
    note: "D1 transcript opt-in: disableAllHooks in the hooks file prints the not-active message (SR_ALL_HOOKS_DISABLED).",
    seed: (sb) => home(sb, COP_HOOKS, json({ disableAllHooks: true, hooks: {} })),
    stubs: { fzf: { "Enable automatic session recording": "yes", "Apply?": "yes" } },
  },
  {
    id: "overlay-yes",
    cli: COP,
    note: "D1 overlay gate: yes installs the community and org staged skills.",
    seed: copStage,
    stubs: { fzf: { "/.copilot/skills? (opt-in)": "yes" } },
  },
  {
    id: "overlay-no",
    cli: COP,
    note: "D1 overlay gate: no installs only the library tier and prints the skip lines.",
    seed: copStage,
    stubs: { fzf: { "/.copilot/skills? (opt-in)": "no" } },
  },
  {
    id: "closed-stdin",
    cli: COP,
    note: "Deviation (e) baseline: a closed standard input and the scripted stubs complete identically.",
    shellOnly: "deviation (e)",
  },
  {
    id: "mempalace-host-nonloopback",
    cli: COP,
    note: "R26 / G3: MEMPALACE_MCP_HOST=0.0.0.0 — the shell probes with the bearer (TypeScript leg deviates).",
    env: { MEMPALACE_MCP_HOST: "0.0.0.0" },
    shellOnly: "delta-01 deviation (o)",
  },
  {
    id: "mempalace-without-packaging",
    cli: COP,
    note: "R26: python3 without `packaging` — the shell stops at the range check.",
    stubs: { noPackaging: true },
    shellOnly: "delta-01 deviation (r)",
  },
  {
    id: "org-mcp-declared",
    cli: COP,
    note: "D1 org MCP: mcp-servers.org.json is folded over the config, framework-reserved > org > operator.",
    seed: both((sb) => home(sb, COP_MCP, json(OPERATOR)), orgManifest),
  },
];

for (const rc of [0, 1, 2] as const) {
  copilot.push({
    id: `ensure-http-rc${rc}`,
    cli: COP,
    note: `R26: ensure_mempalace_http rc ${rc} — the stdio entry is written before; rc 1/2 only print the warning.`,
    stubs: { probe: rc },
    ...(rc === 2 ? { seed: blankToken } : {}),
  });
}
copilot.push(
  {
    id: "tls-delegation-on",
    cli: COP,
    note: "D1 TLS: TLS_DELEGATION=on with a pinned CA bundle wires the delegation.",
    env: { TLS_DELEGATION: "on", CREWRIG_TLS_CA: "ca.pem" },
    seed: (sb) =>
      repoFile(sb, "ca.pem", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"),
  },
  {
    id: "tls-delegation-bad-value",
    cli: COP,
    note: "D1 TLS: TLS_DELEGATION=maybe is rejected with status 1.",
    env: { TLS_DELEGATION: "maybe" },
  },
  {
    id: "deps-step-hit",
    cli: COP,
    note: "D1 deps: a stamp equal to the lock hash skips npm ci.",
    seed: (sb) => repoFile(sb, ".crewrig-state/production-deps.sha256", `${lockHash(sb)}\n`),
  },
  { id: "deps-step-miss", cli: COP, note: "D1 deps: no stamp runs npm ci." },
  {
    id: "deps-step-failure",
    cli: COP,
    note: "D1 deps: a failing npm ci aborts the setup with status 1.",
    stubs: { npmFail: "npm ERR! pin failure" },
  },
);

export const cases: readonly GoldenCase[] = [...copilot, ...pinsB2];
