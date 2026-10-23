// taskfile-commands.ts — find POSIX-only commands in the Taskfile tree (spec 0266 R13, spec 0278 R11).
//
// A Taskfile entry must run on Windows, so a task may name node, npm, npx, git, the forge CLIs
// (gh, glab, tea), the four AI CLIs (claude, gemini, copilot, agy), pipx or python (the MemPalace
// exception), docker and task. Docker stays allowed on purpose: the end-to-end harness already
// spawns it and has no Windows-hostile wrapper. Everything below is flagged.

import type { TaskfileTree } from "./taskfile-tree.ts";

export const FORBIDDEN_UTILITIES: readonly string[] = [
  "bash",
  "sh",
  "jq",
  "yq",
  "awk",
  "sed",
  "grep",
  "mktemp",
  "curl",
  "ln",
  "lsof",
  "ss",
  "xargs",
  "test",
  "[",
];

/** The pseudo-command reported for any `*.sh` path, wherever it appears. */
export const SHELL_PATH = ".sh";
const SHELL_PATH_PATTERN = /[^\s"'`]*\.sh(?![\w.-])/;
const SEPARATORS = /\|\||&&|\$\(|[|;&\n(){}`]/;
const LEADING_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "!",
  "time",
  "exec",
]);

export interface TaskCommand {
  task: string;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!isRecord(value)) {
    return [];
  }
  const out: string[] = [];
  for (const key of ["cmd", "sh"]) {
    out.push(...textsOf(value[key]));
  }
  out.push(...textsOf(value["defer"]));
  return out;
}

function varTexts(vars: unknown): string[] {
  return isRecord(vars)
    ? Object.values(vars).flatMap((v) => (isRecord(v) ? textsOf(v["sh"]) : []))
    : [];
}

/** Every shell text a Taskfile document can run: cmds, cmd, preconditions, status and sh vars. */
export function extractTaskCommands(doc: unknown): TaskCommand[] {
  if (!isRecord(doc)) {
    return [];
  }
  const out: TaskCommand[] = varTexts(doc["vars"]).map((text) => ({
    task: "(top-level vars)",
    text,
  }));
  const tasks = doc["tasks"];
  if (!isRecord(tasks)) {
    return out;
  }
  for (const [task, body] of Object.entries(tasks)) {
    if (!isRecord(body)) {
      continue;
    }
    const texts = [
      ...textsOf(body["cmd"]),
      ...(Array.isArray(body["cmds"]) ? body["cmds"].flatMap(textsOf) : []),
      ...(Array.isArray(body["preconditions"]) ? body["preconditions"].flatMap(textsOf) : []),
      ...(Array.isArray(body["status"]) ? body["status"].flatMap(textsOf) : []),
      ...varTexts(body["vars"]),
    ];
    out.push(...texts.map((text) => ({ task, text })));
  }
  return out;
}

/** Drop whole-line comments and single-quoted bodies (awk programs, sed scripts, grep patterns). */
function stripNoise(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n")
    .replace(/'[^']*'/g, "''");
}

function commandWord(segment: string): { word: string; rest: string[] } | undefined {
  const words = segment
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "");
  while (words.length > 0) {
    const head = words[0] ?? "";
    if (LEADING_KEYWORDS.has(head) || /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(head)) {
      words.shift();
      continue;
    }
    break;
  }
  const word = words.shift();
  return word === undefined ? undefined : { word, rest: words };
}

/** The forbidden commands one shell text uses, in first-seen order, without duplicates. */
export function forbiddenIn(text: string): string[] {
  const found: string[] = [];
  const add = (name: string): void => {
    if (!found.includes(name)) {
      found.push(name);
    }
  };
  if (SHELL_PATH_PATTERN.test(text)) {
    add(SHELL_PATH);
  }
  for (const segment of stripNoise(text).split(SEPARATORS)) {
    const parsed = commandWord(segment);
    if (parsed === undefined) {
      continue;
    }
    const name = parsed.word.replace(/^.*\//, "");
    if (FORBIDDEN_UTILITIES.includes(name)) {
      add(name);
    } else if (name === "command" && parsed.rest[0] === "-v") {
      add("command -v");
    }
  }
  return found;
}

export interface Finding {
  task: string;
  command: string;
}

/** The distinct task+command pairs the Taskfile document uses and the rule forbids. */
export function findForbidden(doc: unknown): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const { task, text } of extractTaskCommands(doc)) {
    for (const command of forbiddenIn(text)) {
      const key = `${task}\u0000${command}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ task, command });
      }
    }
  }
  return out;
}

/**
 * The same findings over a whole Taskfile tree: each task is reported under its EFFECTIVE name
 * (namespace prefix included), so exemption entries keep matching after a split. Top-level vars of
 * every file are reported as "(top-level vars)".
 */
export function findForbiddenInTree(tree: TaskfileTree): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const node of tree.nodes) {
    for (const { task, text } of extractTaskCommands(node.doc)) {
      const effective =
        node.namespace === "" || task === "(top-level vars)" ? task : `${node.namespace}:${task}`;
      for (const command of forbiddenIn(text)) {
        const key = `${effective}\u0000${command}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ task: effective, command });
        }
      }
    }
  }
  return out;
}
