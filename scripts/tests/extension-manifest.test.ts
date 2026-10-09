// extension-manifest.test.ts — the manifest accessors, twins of extension-manifest.sh:39-72,187-202 (spec 0254 R8).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { ExtError } from "../lib/extension/types.ts";
import {
  claudeAuthorName,
  contextSource,
  extBuildDir,
  extGapDir,
  extVersion,
  manifestDescription,
  manifestName,
  manifestVersion,
  readManifest,
  subjectLocation,
  subjectOption,
  subjectPresent,
} from "../lib/extension/manifest.ts";

const scratch: string[] = [];

function manifestOf(text: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-man-"));
  scratch.push(dir);
  const file = path.join(dir, "extension.json");
  fs.writeFileSync(file, text);
  return readManifest(file);
}

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe("readManifest", () => {
  it("reads through a BOM and CRLF", () => {
    const m = manifestOf('﻿{\r\n  "name": "demo",\r\n  "version": "1.2.3"\r\n}\r\n');
    assert.equal(manifestName(m), "demo");
  });

  it("keeps key order, integer-like keys included", () => {
    assert.deepEqual([...manifestOf('{"b":1,"2":2,"1":3}').keys()], ["b", "2", "1"]);
  });

  it("refuses a missing file, malformed JSON and a non-object", () => {
    assert.throws(() => readManifest("/nonexistent/extension.json"), ExtError);
    assert.throws(() => manifestOf("{"), ExtError);
    assert.throws(() => manifestOf("[]"), ExtError);
  });
});

describe("subjects", () => {
  const m = manifestOf(
    JSON.stringify({
      commands: { location: "cmds", mode: "x", off: false, n: 3 },
      skills: null,
      agents: {},
      flag: false,
      text: "str",
    }),
  );

  it("is present when the key exists and is not null", () => {
    assert.equal(subjectPresent(m, "commands"), true);
    assert.equal(subjectPresent(m, "agents"), true);
    assert.equal(subjectPresent(m, "flag"), true);
    assert.equal(subjectPresent(m, "skills"), false);
    assert.equal(subjectPresent(m, "absent"), false);
  });

  it("location falls to the default for absent, null and false", () => {
    assert.equal(subjectLocation(m, "commands", "d"), "cmds");
    assert.equal(subjectLocation(m, "agents", "d"), "d");
    assert.equal(subjectLocation(m, "skills", "d"), "d");
    assert.equal(subjectLocation(m, "absent", "d"), "d");
    assert.equal(subjectLocation(m, "text", "d"), "d");
  });

  it("option renders non-strings as JSON text and defaults to empty", () => {
    assert.equal(subjectOption(m, "commands", "mode"), "x");
    assert.equal(subjectOption(m, "commands", "n"), "3");
    assert.equal(subjectOption(m, "commands", "off", "dflt"), "dflt");
    assert.equal(subjectOption(m, "commands", "missing"), "");
    assert.equal(subjectOption(m, "skills", "mode", "z"), "z");
  });
});

describe("field reads", () => {
  it("name, version and description: verbatim, null when absent or null", () => {
    const m = manifestOf('{"name":"n","version":1,"description":null}');
    assert.equal(manifestName(m), "n");
    assert.equal(manifestVersion(m), "1");
    assert.equal(manifestDescription(m), null);
    assert.equal(manifestName(manifestOf("{}")), null);
    assert.equal(manifestName(manifestOf('{"name":false}')), "false");
  });

  it("extVersion is .version // empty", () => {
    assert.equal(extVersion(manifestOf('{"version":"2.0.0"}')), "2.0.0");
    assert.equal(extVersion(manifestOf("{}")), "");
    assert.equal(extVersion(manifestOf('{"version":null}')), "");
    assert.equal(extVersion(manifestOf('{"version":false}')), "");
    assert.equal(extVersion(manifestOf('{"version":true}')), "true");
  });

  it("claude author name and context source take their defaults", () => {
    assert.equal(claudeAuthorName(manifestOf("{}")), "Unknown");
    assert.equal(claudeAuthorName(manifestOf('{"claude":{"author":"x"}}')), "Unknown");
    assert.equal(claudeAuthorName(manifestOf('{"claude":{"author":{"name":"Ada"}}}')), "Ada");
    assert.equal(contextSource(manifestOf("{}")), "");
    assert.equal(contextSource(manifestOf('{"context":{"source":"CTX.md"}}')), "CTX.md");
  });
});

describe("directories", () => {
  it("lays out build and gap directories", () => {
    assert.equal(extBuildDir("/r", "x"), "/r/build/extensions/x");
    assert.equal(extGapDir("/r", "x"), "/r/build/gaps/x");
  });
});
