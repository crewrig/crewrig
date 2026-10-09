// validate.ts — the manifest validation pass (spec 0254 R9).
// Twin of `ext_validate_manifest` (scripts/lib/extension-manifest.sh:120-167): shape guard,
// per-CLI keys, hooks, MCP shape, MCP tokens, MCP names, in that order. Pure: the caller
// prints the returned lines (the shell wrote them to stderr) and counts a non-empty result as
// a failure.

import { MCP_RESERVED_NAMES } from "../org-mcp.ts";
import { readPerCliKeys } from "./descriptors.ts";
import { assertCurrentShape } from "./shape-guard.ts";
import type { JsonValue } from "./types.ts";
import { validateHooks } from "./validate-hooks.ts";
import { validateMcpNames, validateMcpShape, validateMcpTokens } from "./validate-mcp.ts";
import { validatePerCli } from "./validate-percli.ts";

export interface ValidateInput {
  /** `<repoDir>/scripts/lib`, where the descriptors live. */
  readonly libDir: string;
}

/** Every `VALIDATION-ERROR` line the manifest earns, in the shell's order. */
export function validateManifest(
  manifestPath: string,
  manifest: Map<string, JsonValue>,
  input: ValidateInput,
): string[] {
  const allowlist = `${input.libDir}/extension-percli-keys.json`;
  return [
    ...assertCurrentShape(manifestPath, manifest, input.libDir),
    ...validatePerCli(manifestPath, manifest, allowlist, readPerCliKeys(input.libDir)),
    ...validateHooks(manifestPath, manifest),
    ...validateMcpShape(manifestPath, manifest),
    ...validateMcpTokens(manifestPath, manifest),
    ...validateMcpNames(manifestPath, manifest, [...MCP_RESERVED_NAMES]),
  ];
}
