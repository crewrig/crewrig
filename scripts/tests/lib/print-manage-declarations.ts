// print-manage-declarations.ts — prints the manage-* declarations, one fact per line (spec 0255, plan step 9).
//
// The helper a Bash suite runs to read a TypeScript declaration by evaluating it (delta-01 (b)):
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/tests/lib/print-manage-declarations.ts
//
// Each line is `<cli><TAB><key><TAB><value>`. Destinations and roots are printed in the sentinel
// form the tier-resolution and antigravity suites compare in: `<HOME>` for the user's home,
// `<REPO>` for the repository, `<TIER>` standing for each served overlay tier. The tiers
// themselves are printed from the one COMPONENT_OVERLAY_TIERS. Keys, per CLI:
//
//   script, home, customization-root (antigravity), default-mode, link-prompt, types-line,
//   unknown-type-label, unknown-type-lists-types, refused (when any), tiers, mcp-handler,
//   mcp-target (json), alias.<singular>, and per type: action.<type>, compiled.<type>,
//   refresh-cli.<type> (compiled types), dest.<type> (place types), staging-root.<type> and staging.<type>
//   (compiled types), artifact.<type> (never-compiled types), mcp-key.<type> (json merges),
//   migrates-superseded.<type> (antigravity skills).

import { fileURLToPath } from "node:url";

import { COMPONENT_OVERLAY_TIERS } from "../../lib/component-roots.ts";
import { MANAGE_DESCRIPTORS } from "../../lib/manage/descriptors.ts";
import type { CliDescriptor } from "../../lib/manage/types.ts";

const home = (rel: string): string => `<HOME>/${rel}`;

function cliFacts(d: CliDescriptor): string[] {
  const facts: [string, string][] = [
    ["script", d.script],
    ["home", home(d.home)],
    ["default-mode", d.defaultMode],
    ["link-prompt", String(d.linkPrompt)],
    ["types-line", d.typesLine],
    ["unknown-type-label", d.unknownType.label],
    ["unknown-type-lists-types", String(d.unknownType.listsTypes)],
    ["tiers", COMPONENT_OVERLAY_TIERS.join(" ")],
    ["mcp-handler", d.mcp.kind],
  ];
  if (d.customizationRoot !== undefined)
    facts.push(["customization-root", home(d.customizationRoot)]);
  if (d.refused.length > 0) facts.push(["refused", d.refused.join(" ")]);
  if (d.mcp.kind === "json") facts.push(["mcp-target", home(d.mcp.file)]);
  for (const [singular, plural] of Object.entries(d.aliases))
    facts.push([`alias.${singular}`, plural]);
  for (const t of d.types) {
    const compiled = t.root === "staging";
    facts.push([`action.${t.name}`, t.action], [`compiled.${t.name}`, String(compiled)]);
    // An empty value is never printed: a tab-split read collapses it into a missing field.
    if (t.refreshCli !== "") facts.push([`refresh-cli.${t.name}`, t.refreshCli]);
    if (t.dest !== null) facts.push([`dest.${t.name}`, home(t.dest)]);
    if (compiled)
      facts.push(
        [`staging-root.${t.name}`, t.rootArg],
        [`staging.${t.name}`, `<REPO>/dist/<TIER>/${t.rootArg}`],
      );
    else facts.push([`artifact.${t.name}`, `<REPO>/artifacts/<TIER>/${t.rootArg}`]);
    if (t.mcpKey !== undefined) facts.push([`mcp-key.${t.name}`, t.mcpKey]);
    if (t.migratesSuperseded === true) facts.push([`migrates-superseded.${t.name}`, "true"]);
  }
  return facts.map(([key, value]) => `${d.cli}\t${key}\t${value}`);
}

/** Every fact of every CLI, in descriptor order. */
export function manageDeclarationFacts(): string[] {
  return MANAGE_DESCRIPTORS.flatMap(cliFacts);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(`${manageDeclarationFacts().join("\n")}\n`);
}
