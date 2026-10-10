// setup-steps-copilot.test.ts — the Copilot-only `copilot-workspace-files` step (spec 0256
// requirement 3; shell scripts/setup-copilot-interactive.sh 87-107): the settings template is
// installed when the workspace file is missing, the entry point is reported or warned about, and a
// failed copy stops the run with one `Error:` line. Temp repositories only; the golden cell is
// asserted for the printed bytes.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { copilotSteps } from "../lib/setup/steps-copilot.ts";
import { descriptor, run, sandbox, useSandbox } from "./setup-flow-fixtures.ts";

useSandbox();

const STEPS = { "copilot-workspace-files": copilotSteps["copilot-workspace-files"] };
const TEMPLATE = '{"template":true}\n';

function seed(options: { template?: boolean; settings?: string; entry?: boolean }): {
  settings: string;
  entry: string;
} {
  const repo = sandbox.tmp;
  const put = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  if (options.template !== false) put("config/copilot/settings.json.template", TEMPLATE);
  if (options.settings !== undefined) put(".github/copilot/settings.json", options.settings);
  if (options.entry === true) put(".github/copilot-instructions.md", "# entry\n");
  return {
    settings: path.join(repo, ".github", "copilot", "settings.json"),
    entry: path.join(repo, ".github", "copilot-instructions.md"),
  };
}

const flow = (): ReturnType<typeof descriptor> =>
  descriptor(["copilot-workspace-files"], "copilot");

describe("copilot-workspace-files", () => {
  test("is registered under its id", () => {
    assert.equal(typeof STEPS["copilot-workspace-files"], "function");
  });

  test("installs the template, warns about the missing entry point", async () => {
    const p = seed({});
    const result = await run(flow(), STEPS);
    assert.equal(result.status, 0);
    assert.equal(
      result.out,
      `  Installed: ${p.settings} (from template)\n\n` +
        `  WARN: ${p.entry} is missing — Copilot will not load AGENTS.md without it.\n\n`,
    );
    assert.equal(result.err, "");
    assert.equal(fs.readFileSync(p.settings, "utf8"), TEMPLATE);
  });

  test("leaves an existing settings file untouched and reports the entry point", async () => {
    const p = seed({ template: false, settings: "mine\n", entry: true });
    const result = await run(flow(), STEPS);
    assert.equal(result.status, 0);
    assert.equal(
      result.out,
      `  ${p.settings} already exists, leaving untouched.\n\n  Entry point: ${p.entry}\n\n`,
    );
    assert.equal(fs.readFileSync(p.settings, "utf8"), "mine\n");
  });

  test("a missing template fails closed with one Error line and exit 1", async () => {
    const p = seed({ template: false });
    const result = await run(flow(), STEPS);
    assert.equal(result.status, 1);
    assert.equal(result.out, "");
    assert.match(
      result.err,
      new RegExp(`^Error: cannot install ${p.settings.replace(/\W/g, ".")}: .+\\n$`),
    );
    assert.equal(fs.existsSync(p.settings), false);
  });

  test("matches the golden cell once the repository is substituted", async () => {
    const golden = fs.readFileSync(
      path.join(import.meta.dirname, "fixtures/setup-golden/copilot/default-answers/stdout.golden"),
      "utf8",
    );
    const p = seed({});
    const result = await run(flow(), STEPS);
    const expected = golden.split("\n").slice(4, 8).join("\n").replaceAll("<REPO>", sandbox.tmp);
    assert.ok(expected.includes("(from template)"), "vacuity");
    assert.equal(result.out, `${expected}\n`);
    assert.ok(result.out.includes(p.settings));
  });
});
