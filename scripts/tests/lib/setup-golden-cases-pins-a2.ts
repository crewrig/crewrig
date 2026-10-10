// setup-golden-cases-pins-a2.ts — the PIN cells of the Claude and Gemini shell setups that both CLIs
// share (spec 0256 requirements 25-26, plan v2 step A4b, PR D1 and D2 tables): each pins a property
// the suites verify today by reading the setup TEXT, so the unchanged shell stays guarded by an
// observation. One factory builds the cell for each CLI from its parameters.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { Cli, GoldenCase } from "./setup-golden-types.ts";
import type { SetupSandbox } from "./setup-sandbox.ts";
import { CANCEL } from "./setup-stubs.ts";

type ShellCli = "claude" | "gemini";

interface Params {
  readonly cli: ShellCli;
  readonly name: string;
  readonly home: string;
  readonly capture: Readonly<{ event: string; command: string }>;
}

const PARAMS: readonly Params[] = [
  {
    cli: "claude",
    name: "Claude Code",
    home: ".claude",
    capture: {
      event: "Stop",
      command: 'node "/srv/co/crewrig/hooks/usage-capture.ts" claude-code Stop',
    },
  },
  {
    cli: "gemini",
    name: "Gemini CLI",
    home: ".gemini",
    capture: {
      event: "AfterModel",
      command: 'node "/srv/co/crewrig/hooks/usage-capture.ts" gemini-cli AfterModel',
    },
  },
];

export function put(sb: SetupSandbox, rel: string, text: string): void {
  const file = path.join(sb.home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export const putRepo = (sb: SetupSandbox, rel: string, text: string): void => {
  const file = path.join(sb.repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The settings file an operator already has, holding one usage-capture entry the recognition accepts. */
function installedCapture(p: Params): string {
  return json({
    hooks: { [p.capture.event]: [{ hooks: [{ type: "command", command: p.capture.command }] }] },
  });
}

/** The bearer token file the shell reads: whitespace only, so the probe falls to the placeholder. */
function seedBlankToken(sb: SetupSandbox): void {
  const palace = path.join(fs.realpathSync(sb.home), ".mempalace/palace");
  fs.mkdirSync(path.dirname(palace), { recursive: true });
  const key = createHash("sha256").update(palace).digest("hex").slice(0, 24);
  put(sb, `.mempalace/server/${key}/token`, " \n");
}

const lockHash = (sb: SetupSandbox): string =>
  createHash("sha256")
    .update(fs.readFileSync(path.join(sb.repo, "package-lock.json")))
    .digest("hex");

function seedOverlay(p: Params): (sb: SetupSandbox) => void {
  return (sb) => {
    for (const tier of ["community", "org"]) {
      putRepo(sb, `dist/${tier}/${p.home}/skills/${tier}-demo/SKILL.md`, `# ${tier} demo\n`);
    }
  };
}

function cellsFor(p: Params): GoldenCase[] {
  const { cli, name, home } = p;
  const settings = `${home}/settings.json`;
  const cell = (
    id: string,
    note: string,
    rest: Omit<GoldenCase, "id" | "cli" | "note">,
  ): GoldenCase => ({
    id,
    cli,
    note,
    ...rest,
  });
  const capHeader = `Capture token usage for ${name}?`;
  const keepHeader = `Usage capture is registered for ${name}`;
  const recording = "Enable automatic session recording";
  const out: GoldenCase[] = [
    cell(
      "empty-catalogue-stale-markers",
      "Declined catalogue picks remove stale .selected_team/_expertise/_level and the run continues (D1 row catalogue-picker, spec 0096).",
      {
        stubs: {
          fzf: { "config/teams": CANCEL, "config/expertise": CANCEL, "config/level": CANCEL },
        },
        seed: (sb) => {
          for (const m of ["team", "expertise", "level"])
            put(sb, `${home}/.selected_${m}`, "STALE\n");
        },
      },
    ),
    cell(
      "usage-capture-absent-yes",
      "Usage capture state absent x answer yes registers the capture entry (D1 row usage-capture, spec 0211).",
      {
        stubs: { fzf: { [capHeader]: "yes" } },
      },
    ),
    cell(
      "usage-capture-absent-no",
      "Usage capture state absent x answer no writes no capture entry.",
      {
        stubs: { fzf: { [capHeader]: "no" } },
      },
    ),
    cell(
      "usage-capture-installed-keep",
      "Usage capture state installed x keep leaves the registered entry untouched.",
      {
        stubs: { fzf: { [keepHeader]: "keep" } },
        seed: (sb) => put(sb, settings, installedCapture(p)),
      },
    ),
    cell(
      "usage-capture-installed-remove",
      "Usage capture state installed x remove strips the capture entry.",
      {
        stubs: { fzf: { [keepHeader]: "remove" } },
        seed: (sb) => put(sb, settings, installedCapture(p)),
      },
    ),
    cell(
      "transcript-optin-yes",
      "Session recording yes then Apply yes merges the transcript hooks (D1 row transcripts; Claude also pins the env patch).",
      {
        stubs: { fzf: { [recording]: "yes", "Apply these changes to settings.json?": "yes" } },
      },
    ),
    cell(
      "transcript-optin-no",
      "Session recording no leaves settings.json without transcript hooks.",
      {
        stubs: { fzf: { [recording]: "no" } },
      },
    ),
    cell(
      "transcript-optin-apply-declined",
      "Session recording yes then Apply declined no changes nothing and the run continues.",
      {
        stubs: { fzf: { [recording]: "yes", "Apply these changes to settings.json?": "no" } },
      },
    ),
    cell(
      "overlay-yes",
      "Both overlay tiers present x yes installs the community and org components (D1 row artifact-build-install, spec 0107).",
      {
        stubs: { fzf: { [`components to ~/${home}/skills`]: "yes" } },
        seed: seedOverlay(p),
      },
    ),
    cell("overlay-no", "Both overlay tiers present x no installs neither overlay tier.", {
      stubs: { fzf: { [`components to ~/${home}/skills`]: "no" } },
      seed: seedOverlay(p),
    }),
    cell(
      "org-mcp-declared",
      "An org manifest mcp-servers.org.json is folded into the CLI MCP configuration (D1 validation-and-others row, spec 0091).",
      {
        seed: (sb) =>
          putRepo(
            sb,
            "mcp-servers.org.json",
            json({ mcpServers: { "acme-tools": { command: "acme-mcp", args: ["--serve"] } } }),
          ),
      },
    ),
    cell(
      "tls-delegation-on",
      "TLS_DELEGATION=on with a bundle writes ~/.crewrig/tls-env.sh (spec 0084; D1 row tls); the bundle is a repo file, a path that exists in every sandbox.",
      {
        env: { TLS_DELEGATION: "on", CREWRIG_TLS_CA: "package.json" },
      },
    ),
    cell(
      "tls-delegation-bad-value",
      "TLS_DELEGATION=maybe is rejected with an error and exit 1 (spec 0084).",
      {
        env: { TLS_DELEGATION: "maybe" },
      },
    ),
    cell(
      "deps-step-hit",
      "The production-dependency step is skipped when the stamp equals the lockfile hash (spec 0240 R4-R6).",
      {
        seed: (sb) => {
          putRepo(sb, ".crewrig-state/production-deps.sha256", `${lockHash(sb)}\n`);
          fs.mkdirSync(path.join(sb.repo, "node_modules"), { recursive: true });
        },
      },
    ),
    cell(
      "deps-step-miss",
      "With no stamp the dependency step runs npm ci and records the stamp.",
      {},
    ),
    cell(
      "deps-step-failure",
      "A failing npm ci aborts the setup with exit 1 and a diagnostic (spec 0240 R4-R6).",
      {
        stubs: { npmFail: "npm ERR! simulated failure" },
      },
    ),
    cell(
      "mempalace-without-packaging",
      "A python without packaging stops the shell on the range ERROR.",
      {
        stubs: { noPackaging: true },
        shellOnly: "delta-01 deviation (r)",
      },
    ),
    cell(
      "mempalace-host-nonloopback",
      "MEMPALACE_MCP_HOST=0.0.0.0: the shell probes with the bearer, which delta-01 forbids (requirement 26 scenario).",
      {
        env: { MEMPALACE_MCP_HOST: "0.0.0.0" },
        shellOnly: "delta-01 deviation (o)",
      },
    ),
    cell(
      "closed-stdin",
      "A closed standard input: the baseline of the shell without a terminal or answers.",
      {
        stubs: { fzf: {} },
        shellOnly: "deviation (e)",
      },
    ),
  ];
  for (const rc of [0, 1, 2] as const) {
    out.push(
      cell(
        `ensure-http-rc${rc}`,
        `ensure_mempalace_http returns ${rc}: ${armOf(cli, rc)} (delta-01 requirement 26 arm table).`,
        {
          stubs: {
            probe: rc,
            ...(cli === "claude" ? { claudeServers: { mempalace: "http://existing" } } : {}),
          },
          ...(rc === 2 ? { seed: seedBlankToken } : {}),
          ...(rc === 1 ? { deviations: ["s"] } : {}),
        },
      ),
    );
  }
  return out;
}

function armOf(cli: Cli, rc: number): string {
  if (cli === "claude") {
    return (
      [
        "registers over HTTP",
        "removes the entry and re-registers the stdio wrapper",
        "keeps the existing entry",
      ][rc] ?? ""
    );
  }
  return (
    ["prints the HTTP line", "prints the stdio warning only", "prints the lockout warning only"][
      rc
    ] ?? ""
  );
}

export const sharedCells: readonly GoldenCase[] = PARAMS.flatMap(cellsFor);
