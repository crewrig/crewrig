// setup-declarations-facts.ts — the facts a Bash suite reads about a setup, derived from the four
// descriptors (spec 0256 requirement 9, plan v2 step B3b.5). The F2 precedent is
// print-manage-declarations.ts: a suite never greps the setup text, it evaluates the TypeScript
// declaration through `print-setup-declarations.ts` and reads one fact per line.
//
// A fact is `[key, value]`; the steps are their own ordered list. Paths are printed in sentinel
// form: `<HOME>` for the user's home, `<REPO>` for the checkout, `<TIER>` for a served tier. The
// facts that no descriptor carries (the sub-steps of `mcp`, the prompt headers, the init commands,
// the generated-context targets) are declared here once and pinned by the test against the step
// sources, so a rename in a step file fails a test instead of silently diverging.

import { SEQTHINK_HEADER as CLAUDE_SEQTHINK } from "../../lib/setup/mcp-claude-flow.ts";
import { LEGACY_MCP_HEADER, SETTINGS_HEADER } from "../../lib/setup/mcp-claude-flow.ts";
import { SEQTHINK_HEADER as AGY_SEQTHINK } from "../../lib/setup/mcp-agy-step.ts";
import { mempalaceWrapperScript } from "../../lib/setup/mempalace-stdio.ts";
import { identityInvocation } from "../../lib/setup/prerequisites.ts";
import { rowOf } from "../../lib/setup/prompt-ids.ts";
import type { SetupDescriptor, StepId } from "../../lib/setup/descriptor.ts";
import { OVERLAY_TIERS, overlayHeader } from "../../lib/setup/tier-install.ts";
import { stagingGate, stagingRoot } from "../../lib/setup/tier-build.ts";
import { TLS_QUESTION_HEADER } from "../../lib/setup/tls-offer.ts";
import { trustWrapperPrefix } from "../../lib/setup/trust-wrapper.ts";

export type Fact = readonly [key: string, value: string];

/** A descriptor too empty to be read: the helper fails rather than print a vacuous declaration. */
export class VacuousDeclarationError extends Error {}

const HOME = "<HOME>";
const REPO = "<REPO>";
const home = (rel: string): string => `${HOME}/${rel}`;
const slash = (p: string): string => p.replaceAll("\\", "/");

/** The sub-steps of the steps whose inner order a suite reads, per MCP strategy / CLI. */
export const MCP_SUBSTEPS: Readonly<
  Record<SetupDescriptor["strategies"]["mcp"], readonly string[]>
> = {
  claudeMcp: [
    "backup-claude-json",
    "sequential-thinking",
    "mempalace-detect",
    "chroma-daemon",
    "ensure-mempalace-http",
    "register-stdio-fallback",
    "org-mcp-fold",
    "legacy-mcp-removal",
    "settings-template",
  ],
  geminiMcp: [
    "mempalace-detect",
    "chroma-daemon",
    "org-mcp-read",
    "gemini-settings-write",
    "ensure-mempalace-http",
  ],
  copilotMcp: [
    "backup-capture-operator-servers",
    "mempalace-detect",
    "chroma-daemon",
    "write-mcp-config",
    "org-mcp-fold",
    "ensure-mempalace-http",
  ],
  antigravityMcp: [
    "backup-capture-operator-servers",
    "mempalace-detect",
    "chroma-daemon",
    "sequential-thinking",
    "write-mcp-config",
    "org-mcp-fold",
    "ensure-mempalace-http",
  ],
};

/** The prompts the `mcp` step can ask, per strategy (the step table, section 1.x.a). */
const MCP_PROMPTS = {
  claudeMcp: ["mempalace-install", "install-seqthink", "legacy-mcp-removal", "install-settings"],
  geminiMcp: ["mempalace-install"],
  copilotMcp: ["mempalace-install"],
  antigravityMcp: ["mempalace-install", "install-seqthink"],
} as const;

/** Where the CLI's launcher path lives besides the stdio module: the committed template or `setup`. */
const WRAPPER_CARRIER = {
  claude: "setup",
  gemini: "config/gemini/settings.json",
  copilot: "config/copilot/mcp-config.json.template",
  antigravity: "setup",
} as const;

const USAGE_LABEL = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  copilot: "Copilot CLI",
} as const;
const TRANSCRIPTS_HEADER = "Enable automatic session recording to MemPalace? (opt-in)";
const AGY_KEEP_HEADER =
  "Antigravity usage capture is installed — keep it, or remove it (restores the prior statusLine.command, R21)?";
const AGY_ENABLE_HEADER = "Enable Antigravity CLI usage capture (statusline channel, opt-in)?";

/** The prompt ids one step can ask for this descriptor (the same map the descriptor tests use). */
export function stepPrompts(d: SetupDescriptor, step: StepId): readonly string[] {
  switch (step) {
    case "link-confirm":
      return ["link-confirm"];
    case "rules-existing":
      return ["rules-action"];
    case "rules-shared":
      return [
        "validation.backend",
        "validation.translate",
        "validation.pedagogy",
        "validation.illustration",
      ];
    case "rules-selection":
      return [
        ...d.rules.pickOrder.map((kind) => `catalogue.${kind}`),
        ...(d.rules.profile.mode === "method" ? ["profile-method"] : []),
      ];
    case "tls-offer":
      return ["tls-delegation"];
    case "mcp":
      return MCP_PROMPTS[d.strategies.mcp];
    case "tiers":
      return OVERLAY_TIERS.map((tier) => `overlay.${tier}`);
    case "session-recording":
      return ["transcripts", "transcripts-confirm"];
    case "usage-capture":
      return ["usage-capture", "usage-capture-keep"];
    default:
      return [];
  }
}

/** The header of a prompt when it is a fixed string; `undefined` for the parametric ones. */
export function promptHeader(d: SetupDescriptor, id: string): string | undefined {
  const cli = d.cli;
  if (id === "rules-action") return d.rules.texts["actionHeader"];
  if (id === "tls-delegation") return TLS_QUESTION_HEADER;
  if (id === "install-seqthink") return cli === "antigravity" ? AGY_SEQTHINK : CLAUDE_SEQTHINK;
  if (id === "legacy-mcp-removal") return LEGACY_MCP_HEADER;
  if (id === "install-settings") return SETTINGS_HEADER;
  if (id === "transcripts") return TRANSCRIPTS_HEADER;
  if (id === "transcripts-confirm")
    return d.hooks.channel === "settings" ? "Apply these changes to settings.json?" : "Apply?";
  if (id.startsWith("overlay.")) return overlayHeader({ home: HOME }, cli, id.slice(8));
  if (id === "usage-capture")
    return cli === "antigravity"
      ? AGY_ENABLE_HEADER
      : `Capture token usage for ${USAGE_LABEL[cli]}? (opt-in, MemPalace not required)`;
  if (id === "usage-capture-keep")
    return cli === "antigravity"
      ? AGY_KEEP_HEADER
      : `Usage capture is registered for ${USAGE_LABEL[cli]}. Keep it or remove it?`;
  return undefined;
}

function assertNotVacuous(d: SetupDescriptor): void {
  const empty: string[] = [];
  if (d.steps.length === 0) empty.push("steps");
  for (const [name, value] of [
    ["banner", d.banner],
    ["homes.cliHome", d.homes.cliHome],
    ["homes.rulesDir", d.homes.rulesDir],
    ["homes.skillsDir", d.homes.skillsDir],
    ["rules.existingGlob", d.rules.existingGlob],
    ["hooks.file", d.hooks.file],
    ["hooks.src", d.hooks.src],
    ["summary.listGlob", d.summary.listGlob],
  ] as const)
    if (value === "") empty.push(name);
  if (d.rules.shared.length === 0) empty.push("rules.shared");
  if (d.rules.pickOrder.length === 0) empty.push("rules.pickOrder");
  if (empty.length > 0)
    throw new VacuousDeclarationError(`the ${d.cli} descriptor is empty: ${empty.join(", ")}`);
}

/** Every non-step fact of one descriptor, in a fixed order. */
export function declarationFacts(d: SetupDescriptor): Fact[] {
  assertNotVacuous(d);
  const cli = d.cli;
  const f: Fact[] = [
    ["cli", cli],
    ["banner", d.banner],
  ];
  // Prompts: per step, then per id.
  const askedBy = new Map<string, StepId>();
  for (const step of d.steps) {
    const asked = stepPrompts(d, step);
    if (asked.length === 0) continue;
    f.push([`prompts.${step}`, asked.join(",")]);
    for (const id of asked) askedBy.set(id, step);
  }
  for (const [id, step] of askedBy) {
    const row = rowOf(id);
    f.push([`prompt.${id}.step`, step]);
    f.push([`prompt.${id}.options`, row.catalogue ? `<${row.catalogue}>` : row.options.join(",")]);
    f.push([`prompt.${id}.cancel`, String(row.cancel[cli])]);
    const header = promptHeader(d, id);
    if (header !== undefined) f.push([`prompt.${id}.header`, header]);
  }
  f.push(["init.soul", identityInvocation(cli, "/init-soul")]);
  f.push(["init.profile", identityInvocation(cli, "/init-personal-profile")]);
  // Homes and landing zones.
  f.push(["home.cli", home(d.homes.cliHome)], ["home.rules", home(d.homes.rulesDir)]);
  f.push(["home.skills", home(d.homes.skillsDir)]);
  if (d.homes.agentsDir !== undefined) f.push(["home.agents", home(d.homes.agentsDir)]);
  if (d.homes.settings !== undefined) f.push(["home.settings", home(d.homes.settings)]);
  if (d.homes.mcpConfig !== undefined) f.push(["home.mcp-config", home(d.homes.mcpConfig)]);
  // Rule files.
  f.push(["rules.glob", d.rules.existingGlob], ["rules.shared-header", d.rules.sharedHeader]);
  f.push(["rules.mkdir-in-existing", String(d.rules.mkdirInExisting === true)]);
  const place = (dest: string): string =>
    dest === d.rules.store.dest ? home(dest) : home(`${d.homes.rulesDir}/${dest}`);
  d.rules.shared.forEach((file, i) => {
    const optional = file.optional === true ? " (optional)" : "";
    f.push([`rules.shared.${i + 1}`, `${file.src} -> ${place(file.dest)}${optional}`]);
  });
  f.push(["rules.store", `${d.rules.store.src} -> ${place(d.rules.store.dest)}`]);
  f.push(["rules.pick-order", d.rules.pickOrder.join(",")]);
  for (const kind of d.rules.pickOrder) {
    const file = d.rules.selections[kind];
    f.push([`rules.selection.${kind}`, `${file.src}/{name}.md -> ${place(file.dest)}`]);
    f.push([`rules.marker.${kind}`, home(`${d.homes.cliHome}/.selected_${kind}`)]);
  }
  f.push([
    "rules.profile",
    `${d.rules.profile.mode} ${d.rules.profile.file.src} -> ${place(d.rules.profile.file.dest)}`,
  ]);
  // Tiers.
  const root = (tier: string): string => slash(stagingRoot(REPO, cli, tier));
  f.push(["tiers.strategy", d.strategies.tiers], ["tiers.build-target", cli]);
  f.push(["tiers.staging", root("<TIER>")], ["tiers.library-staging", root("library")]);
  f.push(["tiers.gate", slash(stagingGate(REPO, cli, "<TIER>"))]);
  f.push(["tiers.automatic", "library"], ["tiers.overlay", OVERLAY_TIERS.join(",")]);
  f.push(["tiers.overlay-prompts", OVERLAY_TIERS.map((t) => `overlay.${t}`).join(",")]);
  f.push(["tiers.installs-agents", String(d.homes.agentsDir !== undefined)]);
  f.push(["tiers.migrates-superseded", String(d.steps.includes("migrate-superseded"))]);
  // Hooks.
  f.push(["hooks.channel", d.hooks.channel], ["hooks.file", home(d.hooks.file)]);
  f.push(["hooks.src", `<REPO>/${d.hooks.src}`], ["hooks.env-patch", String(d.hooks.envPatch)]);
  f.push(["hooks.unused-copy", home(d.hooks.unusedCopy)]);
  f.push(["hooks.leading-blank", String(d.hooks.leadingBlank)]);
  f.push([
    "substeps.hooks-rewrite-installed",
    "guard-rewrite,transcript-rewrite,report-unused-copy",
  ]);
  // MCP.
  const prefix = trustWrapperPrefix({ platform: "linux", home: HOME, repoDir: REPO });
  f.push(["mcp.strategy", d.strategies.mcp]);
  f.push(["mcp.handler", d.strategies.mcp === "claudeMcp" ? "claude-cli" : "json-file"]);
  const target = d.homes.mcpConfig ?? d.homes.settings;
  if (target !== undefined) f.push(["mcp.target", home(target)]);
  f.push(["substeps.mcp", MCP_SUBSTEPS[d.strategies.mcp].join(",")]);
  f.push(["mcp.trust-wrapper", prefix.join(" ")]);
  f.push([
    "mcp.wrapper-script",
    mempalaceWrapperScript({ platform: "linux", home: HOME, repoDir: REPO }),
  ]);
  f.push(["mcp.wrapper-carrier", WRAPPER_CARRIER[cli]]);
  // Usage capture, generated context, store guidance.
  f.push(["usage-capture.strategy", d.strategies.usageCapture]);
  f.push([
    "usage-capture.target",
    d.strategies.usageCapture === "statusline"
      ? "<USAGE_ROOT>/state/antigravity-statusline.json"
      : home(d.hooks.file),
  ]);
  f.push(["store-guidance", String(d.storeGuidance)]);
  if (d.steps.includes("legacy-context-cleanup") || d.steps.includes("system-context-file")) {
    f.push(["legacy.gemini-md", home(".gemini/GEMINI.md")]);
    f.push(["legacy.marker", "<!-- crewrig-section:"]);
  }
  if (d.steps.includes("system-context-file"))
    f.push(["system-context-file.target", home(".gemini/config/AGENTS.md")]);
  f.push(["summary.list-header", d.summary.listHeader], ["summary.list-glob", d.summary.listGlob]);
  f.push(["summary.mcp-source", d.summary.mcpSource]);
  return f;
}
