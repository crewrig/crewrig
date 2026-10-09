// unit-render.ts — materialise a supervisor unit from the shipped templates
// (spec 0252 requirement 9; plan v2 D1 `unit-render.ts`).
//
// Same substitutions, same palace-path rule and same residual-placeholder
// refusal as `_materialise_chroma_unit` and `_materialise_mcp_unit` of
// scripts/lib/common.sh, plus the interpreter-token replacement: the `/bin/bash`
// of a plist and the `/usr/bin/env bash` of a unit become the absolute path of
// the running Node.js executable, so the supervisor runs the TypeScript
// programs of requirement 10. A refusal writes nothing.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type UnitFlavour = "plist" | "service";

/** The placeholder values; a key left out is not substituted. */
export interface UnitValues {
  readonly mempalaceHome?: string;
  readonly launcherPath?: string;
  readonly pipxPython?: string;
  readonly chromaBin?: string;
  readonly chromaPalacePath?: string;
  readonly tlsExec?: string;
}

export interface RenderRequest {
  readonly templatePath: string;
  readonly template: string;
  /** The file the rendering is meant for; only named in messages. */
  readonly targetPath: string;
  readonly values: UnitValues;
  /** The absolute path of the running Node.js executable (`process.execPath`). */
  readonly nodePath: string;
}

export type RenderResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

const PLIST_TOKEN = "<string>/bin/bash</string>";
const UNIT_TOKEN_RE = /^ExecStart=\/usr\/bin\/env bash(?=[ \t]|$)/m;
const RESIDUAL_RE = /__[A-Z][A-Z0-9_]*__/;

/** `plist` for a `.plist` template, `service` for anything else. */
export function flavourOf(templatePath: string): UnitFlavour {
  return templatePath.endsWith(".plist") ? "plist" : "service";
}

/**
 * The palace path of the chroma unit: `MEMPALACE_PALACE_PATH` when set and
 * non-empty, else `%h/.mempalace/palace` in a unit and
 * `<home>/.mempalace/palace` in a plist (the shell's rule).
 */
export function chromaPalacePathFor(
  flavour: UnitFlavour,
  home: string,
  override: string | undefined,
): string {
  if (override !== undefined && override !== "") return override;
  return flavour === "service" ? "%h/.mempalace/palace" : `${home}/.mempalace/palace`;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A unit program path with whitespace is quoted so systemd reads one word. */
function unitWord(value: string): string {
  return /\s/.test(value) ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : value;
}

function replaceAllLiteral(text: string, token: string, value: string): string {
  return text.split(token).join(value);
}

/** Render one template. Pure: no file is read or written. */
export function renderUnit(req: RenderRequest): RenderResult {
  const flavour = flavourOf(req.templatePath);
  let text = req.template;

  if (flavour === "plist") {
    if (!text.includes(PLIST_TOKEN)) {
      return tokenLost(req.templatePath, "<string>/bin/bash</string>");
    }
    text = replaceAllLiteral(text, PLIST_TOKEN, `<string>${xmlEscape(req.nodePath)}</string>`);
  } else {
    if (!UNIT_TOKEN_RE.test(text)) {
      return tokenLost(req.templatePath, "ExecStart=/usr/bin/env bash");
    }
    text = text.replace(UNIT_TOKEN_RE, () => `ExecStart=${unitWord(req.nodePath)}`);
  }

  const v = req.values;
  const pairs: ReadonlyArray<readonly [string, string | undefined]> = [
    ["__MEMPALACE_HOME__", v.mempalaceHome],
    ["__LAUNCHER_PATH__", v.launcherPath],
    ["__PIPX_PYTHON__", v.pipxPython],
    ["__CHROMA_BIN__", v.chromaBin],
    ["__CHROMA_PALACE_PATH__", v.chromaPalacePath],
    ["__TLS_EXEC__", v.tlsExec],
  ];
  for (const [token, value] of pairs) {
    if (value === undefined) continue;
    text = replaceAllLiteral(text, token, flavour === "plist" ? xmlEscape(value) : value);
  }

  if (RESIDUAL_RE.test(text)) {
    return {
      ok: false,
      reason: `${req.targetPath} still contains an unsubstituted placeholder.`,
    };
  }
  return { ok: true, text };
}

function tokenLost(templatePath: string, token: string): RenderResult {
  return {
    ok: false,
    reason: `template ${templatePath} no longer carries the interpreter token '${token}' — refusing to materialise it.`,
  };
}

/**
 * Read `templatePath`, render it and write `targetPath` (parent created,
 * mode 0644). A refusal, or an unreadable template, writes nothing.
 */
export function materialiseUnit(
  templatePath: string,
  targetPath: string,
  values: UnitValues,
  nodePath: string,
): RenderResult {
  let template: string;
  try {
    template = readFileSync(templatePath, "utf8");
  } catch {
    return { ok: false, reason: `${templatePath} missing — daemon supervisor unit not shipped.` };
  }
  const result = renderUnit({ templatePath, template, targetPath, values, nodePath });
  if (!result.ok) return result;
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, result.text, { mode: 0o644 });
  return result;
}
