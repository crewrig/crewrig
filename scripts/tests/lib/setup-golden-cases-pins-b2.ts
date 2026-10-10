// setup-golden-cases-pins-b2.ts — the shared seed helpers of the pin-b cells and the ANTIGRAVITY
// pin cells of the golden matrix (spec 0256 requirements 25-26, delta-01, plan v2 step A4b); the
// Copilot cells live in setup-golden-cases-pins-b.ts, which re-exports every case of this module.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { GoldenCase } from "./setup-golden-types.ts";
import type { SetupSandbox } from "./setup-sandbox.ts";

export type Seed = (sb: SetupSandbox) => void;

export const home = (sb: SetupSandbox, rel: string, body: string): void => {
  const file = path.join(sb.home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
export const repoFile = (sb: SetupSandbox, rel: string, body: string): void => {
  const file = path.join(sb.repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};
export const SKILL = "---\nname: pin-skill\ndescription: a staged pin skill\n---\nbody\n";
export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
export const both =
  (...seeds: Seed[]): Seed =>
  (sb) =>
    seeds.forEach((s) => s(sb));

/** The operator's own MCP server, with the repo placeholder in its arguments. */
export const OPERATOR = {
  mcpServers: {
    "operator-tool": { command: "node", args: ["__CREWRIG_REPO_DIR__/op.js"], env: { K: "v" } },
  },
};
/** A whitespace-only bearer token file at the path `mcp_token_path` computes for the sandbox home. */
export const blankToken: Seed = (sb) => {
  const dir = path.join(fs.realpathSync(sb.home), ".mempalace");
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.createHash("sha256").update(`${dir}/palace`).digest("hex").slice(0, 24);
  home(sb, `.mempalace/server/${key}/token`, "  \n");
};
export const emptyCatalogues: Seed = (sb) => {
  for (const dir of ["teams", "expertise", "level"]) {
    const abs = path.join(sb.repo, "config", dir);
    for (const f of fs.readdirSync(abs)) if (f.endsWith(".md")) fs.rmSync(path.join(abs, f));
  }
};
export const lockHash = (sb: SetupSandbox): string =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(sb.repo, "package-lock.json")))
    .digest("hex");

export function orgManifest(sb: SetupSandbox): void {
  repoFile(
    sb,
    "mcp-servers.org.json",
    json({
      mcpServers: {
        "org-stdio": { transport: "stdio", command: "org-bin", args: ["--x"] },
        "org-remote": { transport: "http", url: "https://mcp.example.test/mcp" },
        "operator-tool": { transport: "stdio", command: "org-wins" },
      },
    }),
  );
}

// ---------------------------------------------------------------- Antigravity
const AGY = "antigravity" as const;
const AGY_MCP = ".gemini/config/mcp_config.json";
const AGY_SETTINGS = ".gemini/antigravity-cli/settings.json";
const AGY_MARKER = ".crewrig/usage/state/antigravity-statusline.json";
const OLD_STATUSLINE = 'node "/opt/old/hooks/antigravity-statusline-shim.ts"';
const NODE: readonly string[] = ["node"];
const agyStage: Seed = (sb) => {
  for (const tier of ["library", "community", "org"])
    repoFile(sb, `dist/${tier}/.agents/skills/${tier}-skill/SKILL.md`, SKILL);
};
const installedStatusline: Seed = (sb) => {
  home(sb, AGY_SETTINGS, json({ statusLine: { command: OLD_STATUSLINE } }));
  home(
    sb,
    AGY_MARKER,
    json({ installedStatusLineCommand: OLD_STATUSLINE, priorStatusLineCommand: "prior-cmd" }),
  );
};
const UC_HDR = "Enable Antigravity CLI usage capture";
const UC_INST = "Antigravity usage capture is installed";
const TR = "Enable automatic session recording";
const SECTION = "<!-- crewrig-section: 00_SOUL.md -->";

const antigravity: GoldenCase[] = [
  {
    id: "operator-mcp-preserved",
    cli: AGY,
    note: "R25/D1: the operator's MCP server is captured BEFORE the empty-base rewrite and merged back.",
    seed: (sb) => home(sb, AGY_MCP, json(OPERATOR)),
  },
  {
    id: "empty-catalogue-stale-markers",
    cli: AGY,
    note: "R25/D1: an empty catalogue skips the pick and removes the stale .selected_* markers.",
    seed: both(emptyCatalogues, (sb) => {
      for (const m of ["level", "expertise", "team"])
        home(sb, `.gemini/antigravity-cli/.selected_${m}`, "STALE\n");
    }),
  },
  {
    id: "usage-capture-absent-yes",
    cli: AGY,
    note: "D1 statusline channel: absent + yes installs the statusLine command and the marker.",
    tools: NODE,
    stubs: { fzf: { [UC_HDR]: "yes" } },
  },
  {
    id: "usage-capture-absent-no",
    cli: AGY,
    note: "D1 statusline channel: absent + no writes nothing.",
    stubs: { fzf: { [UC_HDR]: "no" } },
  },
  {
    id: "usage-capture-absent-yes-foreign-statusline",
    cli: AGY,
    note: "D1 statusline channel: a foreign statusLine.command is left untouched (R20).",
    seed: (sb) => home(sb, AGY_SETTINGS, json({ statusLine: { command: "foreign-cmd" } })),
    stubs: { fzf: { [UC_HDR]: "yes" } },
  },
  {
    id: "usage-capture-installed-keep",
    cli: AGY,
    note: "D1 statusline channel: installed + keep rewrites the command through hook-wiring.",
    tools: NODE,
    seed: installedStatusline,
    stubs: { fzf: { [UC_INST]: "keep" } },
  },
  {
    id: "usage-capture-installed-remove",
    cli: AGY,
    note: "D1 statusline channel: installed + remove restores the prior statusLine.command (R21).",
    seed: installedStatusline,
    stubs: { fzf: { [UC_INST]: "remove" } },
  },
  {
    id: "transcript-optin-no",
    cli: AGY,
    note: "D1 transcript opt-in gate: no leaves hooks.json unwritten.",
    stubs: { fzf: { [TR]: "no" } },
  },
  {
    id: "transcript-optin-yes",
    cli: AGY,
    note: "D1 transcript opt-in gate: yes + Apply? yes deploys the transcript hook.",
    tools: NODE,
    stubs: { fzf: { [TR]: "yes", "Apply?": "yes" } },
  },
  {
    id: "transcript-optin-yes-declined",
    cli: AGY,
    note: "D1 transcript opt-in gate: yes + Apply? declined prints the cancellation and writes nothing.",
    tools: NODE,
    stubs: { fzf: { [TR]: "yes", "Apply?": "no" } },
  },
  {
    id: "overlay-yes",
    cli: AGY,
    note: "D1 overlay gate: yes installs the community and org staged components.",
    seed: agyStage,
    stubs: { fzf: { "components to ~/.gemini/config/skills": "yes" } },
  },
  {
    id: "overlay-no",
    cli: AGY,
    note: "D1 overlay gate: no installs only the library tier and prints the skip lines.",
    seed: agyStage,
    stubs: { fzf: { "components to ~/.gemini/config/skills": "no" } },
  },
  {
    id: "tier-install-failure",
    cli: AGY,
    note: "D1/D2: a library tier staging a skill that cannot be placed aborts with status 1 (`|| exit 1`).",
    seed: (sb) =>
      repoFile(sb, "dist/library/.agents/skills/broken-skill/README.md", "no SKILL.md here\n"),
  },
  {
    id: "antigravity-superseded-migration",
    cli: AGY,
    note: "D1/D2: a framework component left at the superseded placement is migrated away.",
    seed: both(
      (sb) =>
        repoFile(
          sb,
          "artifacts/library/skills/pin-skill/SKILL.md",
          "---\nname: pin-skill\nmetadata:\n  provenance:\n    canonical: https://example.test/x\n---\nbody\n",
        ),
      (sb) =>
        home(
          sb,
          ".gemini/antigravity-cli/skills/pin-skill/SKILL.md",
          "---\nname: pin-skill\nmetadata:\n  provenance:\n    canonical: https://example.test/x\n---\nold\n",
        ),
    ),
  },
  {
    id: "legacy-gemini-md-with-marker",
    cli: AGY,
    note: "D1: a legacy ~/.gemini/GEMINI.md carrying the crewrig-section marker is removed.",
    seed: (sb) => home(sb, ".gemini/GEMINI.md", `${SECTION}\n\nlegacy\n`),
  },
  {
    id: "legacy-gemini-md-without-marker",
    cli: AGY,
    note: "D1: a legacy ~/.gemini/GEMINI.md WITHOUT the marker is kept; AGENTS.md carries the section headers.",
    seed: (sb) => home(sb, ".gemini/GEMINI.md", "operator-owned notes\n"),
  },
  {
    id: "closed-stdin",
    cli: AGY,
    note: "Deviation (e) baseline: a closed standard input and the scripted stubs complete identically.",
    shellOnly: "deviation (e)",
  },
  {
    id: "mempalace-host-nonloopback",
    cli: AGY,
    note: "R26 / G3: MEMPALACE_MCP_HOST=0.0.0.0 — the shell probes with the bearer (TypeScript leg deviates).",
    env: { MEMPALACE_MCP_HOST: "0.0.0.0" },
    shellOnly: "delta-01 deviation (o)",
  },
  {
    id: "mempalace-without-packaging",
    cli: AGY,
    note: "R26: python3 without `packaging` — the shell stops at the range check.",
    stubs: { noPackaging: true },
    shellOnly: "delta-01 deviation (r)",
  },
  {
    id: "org-mcp-declared",
    cli: AGY,
    note: "D1 org MCP: mcp-servers.org.json is folded over the config (remote servers as serverUrl).",
    seed: both((sb) => home(sb, AGY_MCP, json(OPERATOR)), orgManifest),
  },
  {
    id: "tls-delegation-on",
    cli: AGY,
    note: "D1 TLS: TLS_DELEGATION=on with a pinned CA bundle wires the delegation.",
    env: { TLS_DELEGATION: "on", CREWRIG_TLS_CA: "ca.pem" },
    seed: (sb) =>
      repoFile(sb, "ca.pem", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"),
  },
  {
    id: "tls-delegation-bad-value",
    cli: AGY,
    note: "D1 TLS: TLS_DELEGATION=maybe is rejected with status 1.",
    env: { TLS_DELEGATION: "maybe" },
  },
  {
    id: "deps-step-hit",
    cli: AGY,
    note: "D1 deps: a stamp equal to the lock hash skips npm ci.",
    seed: (sb) => repoFile(sb, ".crewrig-state/production-deps.sha256", `${lockHash(sb)}\n`),
  },
  { id: "deps-step-miss", cli: AGY, note: "D1 deps: no stamp runs npm ci." },
  {
    id: "deps-step-failure",
    cli: AGY,
    note: "D1 deps: a failing npm ci aborts the setup with status 1.",
    stubs: { npmFail: "npm ERR! pin failure" },
  },
];

for (const rc of [0, 1, 2] as const) {
  antigravity.push({
    id: `ensure-http-rc${rc}`,
    cli: AGY,
    note: `R26: ensure_mempalace_http rc ${rc} — the stdio entry is written before; rc 1/2 only print the warning.`,
    stubs: { probe: rc },
    ...(rc === 2 ? { seed: blankToken } : {}),
    ...(rc === 1 ? { deviations: ["s"] } : {}),
  });
}

export const cases: readonly GoldenCase[] = antigravity;
