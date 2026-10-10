// validation-backend.ts — the user-gate validation backend of the setup graph (spec 0256
// requirement 23), a reproduction of `configure_validation_backend` in scripts/lib/common.sh
// (spec 0080): the `VALIDATION_*` bypass, the four questions, the enum guard, the persisted
// `~/.crewrig/validation.conf` and the lines printed.
//
// Session contract: `choose(question)` of `PromptSession` (./prompt.ts); a cancelled question
// answers the first option (cancel class `default`). The file is written with mode 0644 (the
// shell's `umask 022` result) through a temporary file renamed onto the target.

import fs from "node:fs";
import path from "node:path";

import type { Env, Io } from "../extension/types.ts";
import { createTempNextTo, discardTemp, publishTemp } from "../tmp-file.ts";
import { SetupExit } from "./exit.ts";
import type { Question } from "./prompt.ts";

export interface ValidationSession {
  choose(question: Question): Promise<string | undefined>;
}

/** What the function reads from the setup context. */
export interface ValidationCtx {
  readonly io: Io;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly home: string;
}

export interface ValidationRequest {
  readonly ctx: ValidationCtx;
  readonly session: ValidationSession;
  /** `command -v <name>`; defaults to a scan of `ctx.env.PATH`. */
  readonly hasCommand?: (name: string) => boolean;
}

export const VALIDATION_ENUMS = {
  backend: ["internal", "plannotator"],
  translate: ["off", "on"],
  pedagogy: ["contextual", "simple", "professor"],
  illustration: ["off", "on"],
} as const;

type Key = keyof typeof VALIDATION_ENUMS;

const HEADERS: Readonly<Record<Key, string>> = {
  backend:
    "Validation backend? (internal = built-in AskUserQuestion prompt; plannotator = rich browser review, opt-in)",
  translate:
    "Translate the spec/plan into your preferred language for the gate presentation only? (the repo artifact stays English)",
  pedagogy: "Pedagogy level for validation requests? (simple / contextual / professor)",
  illustration:
    "Generate illustrations for reviews? (honoured only with the plannotator backend + a browser surface)",
};

const ENV_NAMES: Readonly<Record<Key, string>> = {
  backend: "VALIDATION_BACKEND",
  translate: "VALIDATION_TRANSLATE",
  pedagogy: "VALIDATION_PEDAGOGY",
  illustration: "VALIDATION_ILLUSTRATION",
};

/** The order of the questions and of the file lines. */
const KEYS: readonly Key[] = ["backend", "translate", "pedagogy", "illustration"];

const WANT: Readonly<Record<Key, string>> = {
  backend: "internal|plannotator",
  translate: "on|off",
  pedagogy: "simple|contextual|professor",
  illustration: "on|off",
};

type Values = Record<Key, string>;

/** The bytes of `validation.conf`. */
export function validationConfText(values: Values): string {
  return [
    "# crewrig user-gate validation backend (spec 0080)",
    "# Per-user, machine-local; not a committed layer file. Read by the user-validate skill.",
    ...KEYS.map((key) => `${key}=${values[key]}`),
    "",
  ].join("\n");
}

/** `command -v name` over the `PATH` of the context (a regular file with an execute bit; `.exe`/`.cmd`/`.bat` on Windows). */
export function commandOnPath(env: Env, platform: NodeJS.Platform, name: string): boolean {
  const names = platform === "win32" ? [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name];
  const delimiter = platform === "win32" ? ";" : ":";
  for (const dir of (env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const candidate of names) {
      try {
        const file = path.join(dir, candidate);
        if (!fs.statSync(file).isFile()) continue;
        fs.accessSync(file, fs.constants.X_OK);
        return true;
      } catch {
        // not here
      }
    }
  }
  return false;
}

function writeConf(file: string, text: string, platform: NodeJS.Platform): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = createTempNextTo(file);
  try {
    if (platform !== "win32") fs.fchmodSync(tmp.fd, 0o644);
    publishTemp(tmp, text);
  } catch (error) {
    discardTemp(tmp);
    throw error;
  }
}

/**
 * Capture the validation backend and its three options, validate them and persist them to
 * `<home>/.crewrig/validation.conf`. A value outside its enum prints the error on STDOUT (as the
 * shell did) and ends the run with status 1 before the file is touched.
 */
export async function configureValidationBackend(request: ValidationRequest): Promise<void> {
  const { ctx, session } = request;
  const { io, env } = ctx;
  const values: Values = { backend: "", translate: "", pedagogy: "", illustration: "" };
  const defaults: Values = {
    backend: "internal",
    translate: "off",
    pedagogy: "contextual",
    illustration: "off",
  };

  if (KEYS.some((key) => (env[ENV_NAMES[key]] ?? "") !== "")) {
    for (const key of KEYS) {
      const given = env[ENV_NAMES[key]] ?? "";
      values[key] = given !== "" ? given : defaults[key];
    }
  } else {
    io.out("");
    io.out("User-gate validation backend (spec 0080):");
    for (const key of KEYS) {
      const options = VALIDATION_ENUMS[key];
      const answer = await session.choose({
        id: `validation.${key}`,
        header: HEADERS[key],
        options,
        cancel: "default",
      });
      values[key] = answer === undefined || answer === "" ? options[0] : answer;
    }
  }

  for (const key of KEYS) {
    const allowed: readonly string[] = VALIDATION_ENUMS[key];
    if (!allowed.includes(values[key])) {
      io.out(`  ERROR: invalid validation ${key} '${values[key]}' (want: ${WANT[key]})`);
      throw new SetupExit(1);
    }
  }

  const file = path.join(ctx.home, ".crewrig", "validation.conf");
  writeConf(file, validationConfText(values), ctx.platform);
  io.out(
    `  Validation backend recorded: backend=${values.backend} translate=${values.translate} pedagogy=${values.pedagogy} illustration=${values.illustration}`,
  );
  io.out(`    -> ${file}`);

  if (values.backend === "plannotator") {
    io.out("  Plannotator backend selected. Install the binary if it is not present:");
    io.out("    curl -fsSL https://plannotator.ai/install.sh | bash");
    const has = request.hasCommand ?? ((name: string) => commandOnPath(env, ctx.platform, name));
    if (!has("plannotator")) {
      io.out("  Note: 'plannotator' is not on PATH yet — until it is installed, gates");
      io.out("        fall back to the 'internal' backend at gate time (spec 0080 R4).");
    }
  }
}
