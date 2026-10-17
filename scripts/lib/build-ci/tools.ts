// tools.ts — requirement-to-boilerplate recipes of build-ci (spec 0262, twin of
// scripts/build-ci.sh): runtime -> image, tool -> install lines, secondary runtime ->
// install lines. The recipes are text the generated pipeline runs later; this
// generator spawns nothing. An unknown runtime or tool fails closed (delta-02 Scenario 2).

/** A failure the shell reports as one `Error:` line on stderr and a non-zero exit. */
export class BuildCiError extends Error {
  readonly code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

export const DEFAULT_IMAGE = "debian:stable-slim";

/** `runtime_to_image`: `node@22` -> `node:22`, `python@3.12` -> `python:3.12`, "" -> default. */
export function runtimeToImage(runtime: string): string {
  if (runtime.startsWith("node@")) return `node:${runtime.slice(5)}`;
  if (runtime.startsWith("python@")) return `python:${runtime.slice(7)}`;
  if (runtime === "") return DEFAULT_IMAGE;
  throw new BuildCiError(`Error: unknown runtime '${runtime}' — no GitLab image mapping.`);
}

const APT = "apt-get update && apt-get install -y --no-install-recommends";

const TOOLS: Readonly<Record<string, readonly string[]>> = {
  yq: [
    `${APT} wget ca-certificates`,
    "wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64",
    "chmod +x /usr/local/bin/yq",
  ],
  jq: [`${APT} jq`],
  task: ['sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin'],
  "markdownlint-cli": ["npm install -g markdownlint-cli"],
  tesseract: [`${APT} tesseract-ocr`],
  python3: [`${APT} python3`],
};

/** `tool_install_lines`: the before_script lines installing one `requires.tools` entry. */
export function toolInstallLines(tool: string): readonly string[] {
  if (Object.hasOwn(TOOLS, tool)) return TOOLS[tool] as readonly string[];
  throw new BuildCiError(
    `Error: unknown tool '${tool}' — no GitLab install recipe (delta-02 Scenario 2).`,
  );
}

/** `secondary_runtime_install_lines`: install lines for a runtime beyond the image's own. */
export function secondaryRuntimeInstallLines(runtime: string): readonly string[] {
  if (runtime.startsWith("node@")) {
    const major = runtime.slice(5).split(".")[0] as string;
    return [
      `curl -fsSL https://deb.nodesource.com/setup_${major}.x | bash -`,
      "apt-get install -y --no-install-recommends nodejs",
    ];
  }
  if (runtime.startsWith("python@")) return [`${APT} python3`];
  throw new BuildCiError(
    `Error: unknown secondary runtime '${runtime}' — no GitLab install recipe.`,
  );
}
