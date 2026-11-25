// provenance-authored.ts — the reader of the authored provenance block of a source that has no
// frontmatter (spec 0316 R12): one leading comment block holding `provenance:` and, indented,
// `version`, `canonical` and `feedback`. Strict line parser, node built-ins only: setup runs
// before the dependency step, so no YAML library may be imported here.
//
//   <!--                       /*
//   provenance:                provenance:
//     version: "1.0.0"           version: "1.0.0"
//     canonical: "…"             canonical: "…"
//     feedback: "…"              feedback: "…"
//   -->                        */

export type AuthoredSyntax = "html" | "block-js";

export interface AuthoredProvenance {
  readonly version: string;
  readonly canonical?: string;
  readonly feedback?: string;
}

const DELIMS: Record<AuthoredSyntax, readonly [string, string]> = {
  html: ["<!--", "-->"],
  "block-js": ["/*", "*/"],
};

const MEMBER = /^ {2}(version|canonical|feedback): "([^"]*)"$/;

interface Located {
  readonly lines: string[];
  /** Index of the closing delimiter line. */
  readonly close: number;
}

function locate(text: string, file: string, syntax: AuthoredSyntax): Located {
  const [open, closer] = DELIMS[syntax];
  const lines = text.split(/\r?\n/);
  if (lines[0] !== open) {
    throw new Error(
      `${file}: no authored provenance block: the file must start with a line \`${open}\``,
    );
  }
  const close = lines.indexOf(closer, 1);
  if (close < 0)
    throw new Error(`${file}: the authored provenance block is not closed by \`${closer}\``);
  return { lines, close };
}

/** @throws Error `<file>: <reason>` when the block is missing, malformed or has no `version`. */
export function readAuthoredProvenance(
  text: string,
  file: string,
  syntax: AuthoredSyntax,
): AuthoredProvenance {
  const { lines, close } = locate(text, file, syntax);
  if (lines[1] !== "provenance:") {
    throw new Error(`${file}: the authored provenance block must open with \`provenance:\``);
  }
  const found = new Map<string, string>();
  for (let i = 2; i < close; i += 1) {
    const match = MEMBER.exec(lines[i] ?? "");
    if (match === null) {
      throw new Error(
        `${file}: authored provenance line ${i + 1} is not \`  <version|canonical|feedback>: "<value>"\``,
      );
    }
    found.set(match[1] as string, match[2] as string);
  }
  const version = found.get("version");
  if (version === undefined || version === "") {
    throw new Error(
      `${file}: the authored provenance block has no \`version\` (no default version exists)`,
    );
  }
  const canonical = found.get("canonical");
  const feedback = found.get("feedback");
  return {
    version,
    ...(canonical === undefined ? {} : { canonical }),
    ...(feedback === undefined ? {} : { feedback }),
  };
}

/** `text` without its authored block and the one empty line that follows it (line endings kept). */
export function stripAuthoredBlock(text: string, file: string, syntax: AuthoredSyntax): string {
  const { close } = locate(text, file, syntax);
  const parts = text.split(/(?<=\n)/);
  let drop = close + 1;
  if (/^\r?\n$/.test(parts[drop] ?? "x")) drop += 1;
  return parts.slice(drop).join("");
}
