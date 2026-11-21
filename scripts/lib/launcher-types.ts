// launcher-types.ts — strict type check of the organization launcher (spec 0314 R12; plan of issue
// #2101, step 11). The launcher has no extension, so tsc cannot read it: the check copies it byte for
// byte to crewrig.js in a temporary directory whose package.json declares "type": "commonjs", so a
// top-level await is a type error, and runs the repository's tsc on a strict tsconfig there. Error
// locations are reported against the source path, never against the temporary directory.
//
// Header defects are checked on the source text: line 1 the shebang, line 2 `// @ts-check`, and the
// first statement `"use strict";`.
//
// Status: 0 clean; 1 a header defect or a type error; 2 a wiring fault (tsc or @types/node is missing,
// run `task lint-bootstrap`; or the copy or tsc could not run).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The launcher, relative to the repository root (spec 0314 R12). */
export const LAUNCHER_FILE = "templates/org-repo/crewrig";

export interface LauncherCheck {
  status: 0 | 1 | 2;
  lines: string[];
}

const SHEBANG = "#!/usr/bin/env node";
const TS_CHECK = "// @ts-check";
const STRICT_FIRST = '"use strict";';
const DIAGNOSTIC = /^crewrig\.js\((\d+),(\d+)\): (error TS\d+: .*)$/;

/** The header defects of a launcher source; empty when the header is as required. */
export function headerDefects(text: string): string[] {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const defects: string[] = [];
  if (lines[0] !== SHEBANG) defects.push(`line 1 must be '${SHEBANG}'`);
  if (lines[1] !== TS_CHECK) defects.push(`line 2 must be '${TS_CHECK}'`);
  const first = lines.find(
    (line, index) => index >= 2 && line.trim() !== "" && !line.trimStart().startsWith("//"),
  );
  if (first !== STRICT_FIRST) defects.push(`the first statement must be '${STRICT_FIRST}'`);
  return defects;
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The tsconfig of the copy: strict, CommonJS-or-ESM by the sibling package.json, @types/node from the repository. */
function tsconfig(typeRoot: string): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        noEmit: true,
        allowJs: true,
        checkJs: true,
        skipLibCheck: true,
        target: "ES2023",
        lib: ["ES2023"],
        module: "nodenext",
        moduleDetection: "force",
        types: ["node"],
        typeRoots: [typeRoot],
      },
      files: ["crewrig.js"],
    },
    null,
    2,
  )}\n`;
}

/** Check the launcher at `file` (relative to `root`): header defects, then a strict tsc run on a copy. */
export function checkLauncher(root: string, file: string = LAUNCHER_FILE): LauncherCheck {
  const repo = path.resolve(root);
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.resolve(repo, file));
  } catch {
    return { status: 1, lines: [`${file}: the launcher is absent or unreadable`] };
  }
  const lines = headerDefects(bytes.toString("utf8")).map((defect) => `${file}: ${defect}`);
  let status: 0 | 1 | 2 = lines.length > 0 ? 1 : 0;

  const tsc = path.join(repo, "node_modules", "typescript", "bin", "tsc");
  const typeRoot = path.join(repo, "node_modules", "@types");
  if (!fs.existsSync(tsc)) {
    return {
      status: 2,
      lines: [...lines, "tsc not found under node_modules/typescript (run `task lint-bootstrap`)"],
    };
  }
  if (!fs.existsSync(path.join(typeRoot, "node", "package.json"))) {
    return {
      status: 2,
      lines: [
        ...lines,
        "@types/node not found under node_modules/@types (run `task lint-bootstrap`)",
      ],
    };
  }

  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "crewrig-launcher-types-"));
  try {
    const copy = path.join(dir, "crewrig.js");
    fs.writeFileSync(copy, bytes);
    if (digest(fs.readFileSync(copy)) !== digest(bytes)) {
      return {
        status: 2,
        lines: [...lines, `${file}: the type-check copy differs from the source`],
      };
    }
    fs.writeFileSync(path.join(dir, "package.json"), '{"type":"commonjs"}\n');
    fs.writeFileSync(path.join(dir, "tsconfig.json"), tsconfig(typeRoot));

    const res = spawnSync(
      process.execPath,
      [tsc, "-p", path.join(dir, "tsconfig.json"), "--pretty", "false"],
      {
        cwd: dir,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (res.error !== undefined) {
      return { status: 2, lines: [...lines, `tsc could not run: ${res.error.message}`] };
    }
    let diagnostics = 0;
    for (const raw of `${res.stdout ?? ""}${res.stderr ?? ""}`.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.trim() === "") continue;
      const match = DIAGNOSTIC.exec(line);
      if (match !== null) {
        diagnostics += 1;
        lines.push(`${file}:${match[1]}:${match[2]}: ${match[3]}`);
      } else {
        lines.push(`${file}: ${line.split(dir).join("<copy>")}`);
      }
    }
    if (diagnostics > 0) {
      status = 1;
    } else if (res.status !== 0) {
      return {
        status: 2,
        lines: [...lines, `tsc failed without a diagnostic (exit ${res.status ?? "none"})`],
      };
    }
    return { status, lines };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
