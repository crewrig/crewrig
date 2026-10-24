// tools.ts — requirement-to-boilerplate recipes of build-ci (spec 0262, twin of
// the retired scripts/build-ci.sh): runtime -> image, tool -> install lines, secondary runtime ->
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

/** The pinned Task release (ci/task-pin.json, spec 0282): the one source of both engines. */
export interface TaskPin {
  readonly version: string;
  readonly sha256: Readonly<Record<string, string>>;
}

/** Parse the pin text; any missing or malformed field fails closed (spec 0282 R5). */
export function parseTaskPin(text: string): TaskPin {
  const bad = (why: string): never => {
    throw new BuildCiError(`Error: ci/task-pin.json: ${why}.`);
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad("not valid JSON");
  }
  const o = raw as { version?: unknown; sha256?: Record<string, unknown> } | null;
  if (o === null || typeof o !== "object") return bad("not an object");
  if (typeof o.version !== "string" || !/^\d+\.\d+\.\d+$/.test(o.version))
    return bad("'version' must be x.y.z");
  const sum = o.sha256?.["linux_amd64"];
  if (typeof sum !== "string" || !/^[0-9a-f]{64}$/.test(sum))
    return bad("'sha256.linux_amd64' must be 64 lowercase hex digits");
  return { version: o.version, sha256: { linux_amd64: sum } };
}

/** The GitLab `task` recipe: pinned release, checksum-verified, then a failing version check. */
export function taskRecipe(pin: TaskPin): readonly string[] {
  const url = `https://github.com/go-task/task/releases/download/v${pin.version}/task_linux_amd64.tar.gz`;
  return [
    `${APT} curl ca-certificates`,
    `curl --fail --silent --show-error --location --retry 3 -o /tmp/task.tar.gz ${url}`,
    `echo "${pin.sha256["linux_amd64"]}  /tmp/task.tar.gz" | sha256sum -c -`,
    "tar -xzf /tmp/task.tar.gz -C /usr/local/bin task",
    "task --version",
  ];
}

const TOOLS: Readonly<Record<string, readonly string[]>> = {
  yq: [
    `${APT} wget ca-certificates`,
    "wget -qO /usr/local/bin/yq https://github.com/mikefarah/yq/releases/download/v4.54.1/yq_linux_amd64",
    'echo "8e34fc298390875de416e6a4afcb8cabeceb25d9aa8506c1a2f9353cf702ea5f  /usr/local/bin/yq" | sha256sum -c -',
    "chmod +x /usr/local/bin/yq",
  ],
  jq: [
    `${APT} wget ca-certificates`,
    "wget -qO /usr/local/bin/jq https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64",
    'echo "5942c9b0934e510ee61eb3e30273f1b3fe2590df93933a93d7c58b81d19c8ff5  /usr/local/bin/jq" | sha256sum -c -',
    "chmod +x /usr/local/bin/jq",
  ],
  "markdownlint-cli": ["npm install -g markdownlint-cli"],
  tesseract: [`${APT} tesseract-ocr`],
  python3: [`${APT} python3`],
};

/** `tool_install_lines`: the before_script lines installing one `requires.tools` entry. */
export function toolInstallLines(tool: string, pin: TaskPin): readonly string[] {
  if (tool === "task") return taskRecipe(pin);
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
