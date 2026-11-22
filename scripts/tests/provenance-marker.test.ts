// provenance-marker.test.ts — the shared marker writer (spec 0316 R1, R3, R6):
// scripts/lib/provenance-marker.ts, the only writer of marker bytes.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  markerLine,
  markerYaml,
  packageNameOf,
  ProvenanceMarkerError,
  replaceMarker,
  spliceMarkerYaml,
} from "../lib/provenance-marker.ts";
import type { ProvenanceFields } from "../lib/provenance-marker.ts";

const ALL: ProvenanceFields = {
  package: "crewrig",
  extension: "ext",
  version: "1.0.0",
  canonical: "https://h/o/r",
  feedback: "https://h/o/f",
};
const PAYLOAD =
  'crewrig-provenance: package="crewrig" extension="ext" version="1.0.0" canonical="https://h/o/r" feedback="https://h/o/f"';

const refused = (field: string) => (e: unknown) =>
  e instanceof ProvenanceMarkerError && e.field === field;

describe("markerLine and markerYaml", () => {
  test("fixed order in the three syntaxes", () => {
    assert.equal(markerLine(ALL, "html"), `<!-- ${PAYLOAD} -->`);
    assert.equal(markerLine(ALL, "hash"), `# ${PAYLOAD}`);
    assert.equal(markerLine(ALL, "block-js"), `/* ${PAYLOAD} */`);
  });

  test("an absent or empty member is omitted, whatever the order of the keys given", () => {
    const f = {
      feedback: "",
      version: "2",
      package: "p",
      extension: undefined,
    } as ProvenanceFields;
    assert.equal(markerLine(f, "hash"), '# crewrig-provenance: package="p" version="2"');
    assert.equal(markerYaml(f), 'metadata:\n  provenance:\n    package: "p"\n    version: "2"');
  });

  test("the YAML block carries the same members in the same order", () => {
    assert.equal(
      markerYaml(ALL),
      [
        "metadata:",
        "  provenance:",
        '    package: "crewrig"',
        '    extension: "ext"',
        '    version: "1.0.0"',
        '    canonical: "https://h/o/r"',
        '    feedback: "https://h/o/f"',
      ].join("\n"),
    );
  });

  test("an empty package, a double quote, a CR and an LF are refused", () => {
    assert.throws(() => markerLine({ package: "" }, "html"), refused("package"));
    for (const bad of ['a"b', "a\rb", "a\nb"]) {
      assert.throws(() => markerLine({ package: "p", version: bad }, "html"), refused("version"));
      assert.throws(() => markerYaml({ package: "p", feedback: bad }), refused("feedback"));
    }
  });
});

describe("replaceMarker", () => {
  const f: ProvenanceFields = { package: "p", version: "1" };
  const html = '<!-- crewrig-provenance: package="p" version="1" -->';

  test("html: inserted right after the closing fence, or on line 1 without frontmatter", () => {
    assert.equal(replaceMarker("---\na: 1\n---\nBody", f, "html"), `---\na: 1\n---\n${html}\nBody`);
    assert.equal(replaceMarker("Body", f, "html"), `${html}\nBody`);
  });

  test("html: an existing marker is replaced, never merged; blank lines are kept", () => {
    const old = '<!-- crewrig-provenance: version="0" canonical="c" -->';
    assert.equal(
      replaceMarker(`---\na: 1\n---\n${old}\nBody`, f, "html"),
      `---\na: 1\n---\n${html}\nBody`,
    );
    assert.equal(
      replaceMarker(`---\na: 1\n---\n\n${old}\nBody`, f, "html"),
      `---\na: 1\n---\n\n${html}\nBody`,
    );
    assert.equal(replaceMarker(`${old}\n${old}\nBody`, f, "html"), `${html}\nBody`);
  });

  test("a marker quoted in the body is content and stays", () => {
    const quoted = `Body\n${html}\nend`;
    assert.equal(
      replaceMarker(`---\na: 1\n---\n${quoted}`, f, "html"),
      `---\na: 1\n---\n${html}\n${quoted}`,
    );
  });

  test("hash: line 1; block-js: line 1, or line 2 after a shebang", () => {
    assert.equal(
      replaceMarker('# crewrig-provenance: version="0"\ndescription = "d"', f, "hash"),
      '# crewrig-provenance: package="p" version="1"\ndescription = "d"',
    );
    assert.equal(
      replaceMarker("#!/usr/bin/env node\ncode", f, "block-js"),
      '#!/usr/bin/env node\n/* crewrig-provenance: package="p" version="1" */\ncode',
    );
    assert.equal(
      replaceMarker("code", f, "block-js"),
      '/* crewrig-provenance: package="p" version="1" */\ncode',
    );
  });

  test("idempotent", () => {
    for (const syntax of ["html", "hash", "block-js"] as const) {
      const once = replaceMarker("---\na: 1\n---\nBody\n", f, syntax);
      assert.equal(replaceMarker(once, f, syntax), once, syntax);
    }
  });
});

describe("spliceMarkerYaml", () => {
  const f: ProvenanceFields = { package: "p", version: "1" };
  const B = 'metadata:\n  provenance:\n    package: "p"\n    version: "1"';

  test("the block lands before the closing fence", () => {
    assert.equal(spliceMarkerYaml("---\na: 1\n---\nz", f), `---\na: 1\n${B}\n---\nz`);
  });

  test("fewer than two fences: unchanged", () => {
    assert.equal(spliceMarkerYaml("---\nonly", f), "---\nonly");
  });

  test("an existing provenance-only metadata block is replaced, never merged (R6)", () => {
    const old =
      '---\na: 1\nmetadata:\n  provenance:\n    version: "0"\n    canonical: "c"\nb: 2\n---\nz';
    assert.equal(spliceMarkerYaml(old, f), `---\na: 1\n${B}\nb: 2\n---\nz`);
  });

  test("a metadata block with another child is refused: a second key would be a duplicate", () => {
    const text = "---\nmetadata:\n  other: 1\n---\nz";
    assert.throws(() => spliceMarkerYaml(text, f), refused("metadata"));
    const both = "---\nmetadata:\n  provenance:\n    version: 1\n  other: 1\n---\nz";
    assert.throws(() => spliceMarkerYaml(both, f), refused("metadata"));
  });
});

describe("packageNameOf", () => {
  const write = (content: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-"));
    const file = path.join(dir, "package.json");
    fs.writeFileSync(file, content);
    return file;
  };

  test("the name of a package.json", () => {
    assert.equal(packageNameOf(write('{ "name": "crewrig" }')), "crewrig");
  });

  test("a missing file, bad JSON, a missing, empty or non-string name: refused, naming the file", () => {
    const missing = path.join(os.tmpdir(), "pm-absent", "package.json");
    assert.throws(() => packageNameOf(missing), refused(missing));
    for (const content of ["{", "{}", '{ "name": "" }', '{ "name": 3 }']) {
      const file = write(content);
      assert.throws(() => packageNameOf(file), refused(file), content);
    }
  });
});
