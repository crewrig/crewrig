// extension-context.test.ts — the pure context renderer (spec 0254 R16): the five span rules,
// the eight diagnostics with their exact text and line, the mask, the references, the
// near-miss scan and the reserved bytes. The shell twin is compared in extension-context-shell.test.ts.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { renderContext, type RenderInput } from "../lib/extension/context-render.ts";

const KNOWN = ["gemini", "claude", "copilot", "antigravity"];

function base(source: string, over: Partial<RenderInput> = {}): RenderInput {
  return {
    source,
    sourceName: "ctx.md",
    target: "claude",
    knownTargets: KNOWN,
    displayName: "Claude Code",
    commandRef: "`/{ext}:{name}`",
    skillRef: "`/{ext}:{name}`",
    extName: "demo",
    declaredCommands: ["greet"],
    declaredSkills: ["helper"],
    ...over,
  };
}

function text(source: string, over: Partial<RenderInput> = {}): string {
  const result = renderContext(base(source, over));
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.text : "";
}

function diagnostics(source: string, over: Partial<RenderInput> = {}): string[] {
  const result = renderContext(base(source, over));
  assert.equal(result.ok, false);
  return result.ok ? [] : result.diagnostics;
}

describe("span rules", () => {
  test("a dropped span splices the text around it into one line", () => {
    assert.equal(text("a ${ONLY:gemini}x\ny${ENDONLY} b\n"), "a  b\n");
  });

  test("a kept span loses only its markers", () => {
    assert.equal(text("a ${ONLY:claude,gemini}kept${ENDONLY} b"), "a kept b");
    assert.equal(text("a ${EXCEPT:gemini}kept${ENDEXCEPT} b"), "a kept b");
  });

  test("a dropped EXCEPT span and a lone-line consumed interior", () => {
    assert.equal(text("a\n${EXCEPT:claude}\nmid\n${ENDEXCEPT}\nb\n"), "a\n\nb\n");
  });

  test("a kept span on lines of its own leaves no blank line behind", () => {
    assert.equal(text("a\n${ONLY:claude}\nmid\n${ENDONLY}\nb\n"), "a\nmid\nb\n");
  });

  test("a line that was already blank survives, a CR-only whitespace line does not", () => {
    assert.equal(text("a\n\n${ONLY:claude}\nx\n${ENDONLY}\nb\n"), "a\n\nx\nb\n");
    assert.equal(text("a\n \t\n${ONLY:claude}\r\nx\n${ENDONLY}\r\nb\n"), "a\n \t\nx\nb\n");
  });

  test("whitespace around a sentinel line is dropped with it", () => {
    assert.equal(text("a\n  ${ONLY:claude}  \nx\n  ${ENDONLY}\t\nb"), "a\nx\nb");
  });

  test("target names are trimmed and a literal $${ONLY:copilot} survives", () => {
    assert.equal(text("${ONLY: claude\t, gemini }x${ENDONLY}"), "x");
    assert.equal(text("$${ONLY:copilot} and $${X}"), "${ONLY:copilot} and ${X}");
  });

  test("an empty element in the list is not an unknown name (as in the shell)", () => {
    assert.equal(text("${ONLY:claude,}x${ENDONLY}"), "x");
    assert.equal(text("${ONLY:nope,}x${ENDONLY}"), "");
  });

  test("trailing line feeds are preserved", () => {
    assert.equal(text("a\n\n\n"), "a\n\n\n");
    assert.equal(text(""), "");
    assert.equal(text("\n"), "\n");
  });
});

describe("span diagnostics", () => {
  test("UNKNOWN-TARGET names the last unknown of the list", () => {
    assert.deepEqual(diagnostics("x\n${ONLY:bad1, claude, bad2}y${ENDONLY}"), [
      "UNKNOWN-TARGET: ctx.md:2 - 'bad2' is not a known render target",
    ]);
  });

  test("EMPTY-TARGET-LIST", () => {
    assert.deepEqual(diagnostics("a\nb\n${EXCEPT:}"), [
      "EMPTY-TARGET-LIST: ctx.md:3 - ${EXCEPT:} names no target",
    ]);
  });

  test("SPAN-KEPT-NOWHERE keeps the raw list in the text", () => {
    assert.deepEqual(diagnostics("${EXCEPT: gemini,claude,copilot,antigravity }x${ENDEXCEPT}"), [
      "SPAN-KEPT-NOWHERE: ctx.md:1 - ${EXCEPT: gemini,claude,copilot,antigravity } names every known target; this span is kept on none of them",
    ]);
  });

  test("UNCLOSED-BLOCK at the end of the file reports the opener's line", () => {
    assert.deepEqual(diagnostics("a\n${ONLY:claude}\nx\n"), [
      "UNCLOSED-BLOCK: ctx.md:2 - ONLY span opened here has no matching close before end of file",
    ]);
  });

  test("UNCLOSED-BLOCK for a marker without a closing brace", () => {
    assert.deepEqual(diagnostics("a\nb ${EXCEPT:claude"), [
      "UNCLOSED-BLOCK: ctx.md:2 - EXCEPT marker has no closing brace",
    ]);
  });

  test("STRAY-BLOCK-END", () => {
    assert.deepEqual(diagnostics("a\n\n${ENDONLY}"), [
      "STRAY-BLOCK-END: ctx.md:3 - ENDONLY with no span open",
    ]);
    assert.deepEqual(diagnostics("a ${ENDEXCEPT}"), [
      "STRAY-BLOCK-END: ctx.md:1 - ENDEXCEPT with no span open",
    ]);
  });

  test("MISMATCHED-BLOCK-END", () => {
    assert.deepEqual(diagnostics("${ONLY:claude}\nx\n${ENDEXCEPT}"), [
      "MISMATCHED-BLOCK-END: ctx.md:3 - a ONLY span closed by ENDEXCEPT",
    ]);
    assert.deepEqual(diagnostics("${EXCEPT:gemini}x${ENDONLY}"), [
      "MISMATCHED-BLOCK-END: ctx.md:1 - a EXCEPT span closed by ENDONLY",
    ]);
  });

  test("NESTED-BLOCK covers containment and crossing; the first error stops the scan", () => {
    assert.deepEqual(diagnostics("${ONLY:claude}\n${ONLY:gemini}x${ENDONLY}${ENDONLY}"), [
      "NESTED-BLOCK: ctx.md:2 - a new ONLY span opened while a ONLY span is already open",
    ]);
    assert.deepEqual(diagnostics("${ONLY:claude}a${EXCEPT:gemini}b${ENDONLY}c${ENDEXCEPT}"), [
      "NESTED-BLOCK: ctx.md:1 - a new EXCEPT span opened while a ONLY span is already open",
    ]);
  });

  test("lines are counted over the masked text, not the rendered one", () => {
    assert.deepEqual(diagnostics("$${a}\n$${b}\n${ENDONLY}"), [
      "STRAY-BLOCK-END: ctx.md:3 - ENDONLY with no span open",
    ]);
  });
});

describe("references and names", () => {
  test("${TOOL}, ${EXTENSION}, ${COMMAND:x} and ${SKILL:x} resolve through the templates", () => {
    assert.equal(
      text("${TOOL} in ${EXTENSION}: ${COMMAND:greet} ${SKILL:helper}"),
      "Claude Code in demo: `/demo:greet` `/demo:helper`",
    );
  });

  test("replacement values are literal: & and $& are inert", () => {
    const out = text("${TOOL}|${EXTENSION}|${COMMAND:greet}", {
      displayName: "T$&T&",
      extName: "e$&e&",
      commandRef: "`$&/{ext}&{name}$$`",
    });
    assert.equal(out, "T$&T&|e$&e&|`$&/e$&e&&greet$$`");
  });

  test("a reference to a command is not resolved against skills and the reverse", () => {
    assert.deepEqual(diagnostics("${COMMAND:helper} ${SKILL:greet}"), [
      "UNRESOLVED-REFERENCE: ctx.md:1 - ${COMMAND:helper}",
      "UNRESOLVED-REFERENCE: ctx.md:1 - ${SKILL:greet}",
    ]);
  });

  test("every unresolved reference is named, with its line over the spliced text", () => {
    assert.deepEqual(
      diagnostics("a\n${ONLY:gemini}x\ny${ENDONLY}\n${COMMAND:nope}\n${SKILL:gone}"),
      [
        "UNRESOLVED-REFERENCE: ctx.md:3 - ${COMMAND:nope}",
        "UNRESOLVED-REFERENCE: ctx.md:4 - ${SKILL:gone}",
      ],
    );
  });

  test("an unterminated ${COMMAND: is left as is and stops the scan", () => {
    assert.equal(text("a ${COMMAND:greet"), "a ${COMMAND:greet");
  });

  test("an empty reference name matches the shell's padded entry list", () => {
    assert.equal(text("${COMMAND:}", { commandRef: "<{name}>" }), "<>");
  });

  test("a reference inside a masked $${ is not resolved", () => {
    assert.equal(text("$${COMMAND:nope}"), "${COMMAND:nope}");
  });

  test("a span's own markers are not mistaken for references", () => {
    assert.equal(text("${ONLY:claude}${COMMAND:greet}${ENDONLY}"), "`/demo:greet`");
  });
});

describe("near-miss scan", () => {
  function warnings(source: string): string[] {
    const result = renderContext(base(source));
    assert.equal(result.ok, true);
    return result.ok ? result.warnings : [];
  }

  test("an upper-case unknown token warns with its line; the vocabulary and SKELETON_NAME do not", () => {
    assert.deepEqual(warnings("a\n${TOOl} ${FOO} ${FOO_BAR:x} ${SKELETON_NAME} ${ONLY2}\n"), [
      "Warning: ctx.md:2 — '${FOO}' has the shape of a vocabulary token but matches none; passed through verbatim",
      "Warning: ctx.md:2 — '${FOO_BAR:x}' has the shape of a vocabulary token but matches none; passed through verbatim",
    ]);
  });

  test("lowercase, mixed-case and underscore-led identifiers pass silently", () => {
    assert.deepEqual(warnings("${extensionPath} ${TOOl} ${_FOO} ${Foo} ${CLAUDE_PLUGIN_ROOT}"), [
      "Warning: ctx.md:1 — '${CLAUDE_PLUGIN_ROOT}' has the shape of a vocabulary token but matches none; passed through verbatim",
    ]);
  });

  test("an escaped $${FOO} is scanned after the unmask, like the shell", () => {
    assert.deepEqual(warnings("$${FOO}"), [
      "Warning: ctx.md:1 — '${FOO}' has the shape of a vocabulary token but matches none; passed through verbatim",
    ]);
  });

  test("a token never crosses a line", () => {
    assert.deepEqual(warnings("${FOO:a\nb}"), []);
  });
});

describe("reserved bytes", () => {
  test("U+0001 and U+0003 in the source fail with the reserved-byte error", () => {
    assert.deepEqual(diagnostics("a\u0001b"), [
      "ERROR: ctx.md — source already contains a reserved control byte (U+0001); cannot render",
    ]);
    assert.deepEqual(diagnostics("a\u0003b"), [
      "ERROR: ctx.md — source already contains a reserved control byte (U+0003); cannot render",
    ]);
  });
});
