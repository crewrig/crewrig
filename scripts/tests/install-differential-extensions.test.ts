// install-differential-extensions.test.ts — the differential proof, second half (spec 0255 R27;
// PR C step 16): the extension installers, the link and unlink entries, the plugin installers and
// install-extension-all, the shell and the TypeScript entry over identical sandboxes. See
// install-differential.test.ts for the manage matrix and lib/install-differential.ts for the
// harness. Each expected difference carries its `deviation: R22(<letter>)` tag; an unlisted real
// difference is a node:test `todo` finding. Retires with the shell scripts (PR E).

import fs from "node:fs";
import { describe, it } from "node:test";

import {
  expectSame,
  placeHello,
  twin,
  USAGE_PREFIX,
  USAGE_PREFIX_ERR,
} from "./lib/install-differential.ts";
import type { Deviation, Twin, TwinOptions } from "./lib/install-differential.ts";
import { stubCli } from "./lib/install-sandbox.ts";
import type { InstallSandbox } from "./lib/install-sandbox.ts";
import { which } from "./lib/worktree-fixtures.ts";

const SKIP: string | false =
  process.platform === "win32"
    ? "POSIX only"
    : which("jq") === null
      ? "jq is not installed"
      : false;

function check(
  title: string,
  run: () => Twin,
  devs: readonly Deviation[] = [],
  todo?: string,
): void {
  it(title, { skip: SKIP, ...(todo === undefined ? {} : { todo }) }, () => expectSame(run(), devs));
}

/** A renderable extension (manifest name = directory name); `valid: false` breaks the JSON. */
function ext(box: InstallSandbox, tier: string, name: string, valid = true): void {
  const manifest = {
    name,
    version: "0.0.1",
    description: "fixture",
    commands: { location: "commands/" },
  };
  box.tree.write(
    `extensions/${tier}/${name}/extension.json`,
    valid ? JSON.stringify(manifest) : "{not json",
  );
  box.tree.write(
    `extensions/${tier}/${name}/commands/x.md`,
    "---\nname: x\ndescription: d\ntype: command\n---\nbody\n",
  );
}
const some = (box: InstallSandbox): void => {
  ext(box, "core", "alpha");
  ext(box, "library", "beta");
  ext(box, "org", "gamma");
};
const installed = (box: InstallSandbox): void => {
  fs.mkdirSync(`${box.home}/.gemini/extensions/alpha`, { recursive: true });
  fs.writeFileSync(`${box.home}/.gemini/extensions/alpha/gemini-extension.json`, "{}");
  fs.mkdirSync(`${box.home}/.gemini/extensions/beta`, { recursive: true });
};

describe("install-extension", () => {
  const go = (args: string[], o: TwinOptions = {}, setup = some) =>
    twin(setup, "install-extension", args, o);
  check("install one", () => go(["install", "alpha"]));
  check("link one", () => go(["link", "alpha"]));
  check("default mode", () => go([]));
  check("existing destination replaced", () =>
    go(["install", "alpha"], {}, (b) => (some(b), installed(b))),
  );
  check("not found", () => go(["install", "nope"]));
  check("all extensions, install", () => go(["install"]));
  check("all extensions, link", () => go(["link"]));
  check("--include-org argument", () => go(["install", "--include-org"]));
  check("INCLUDE_ORG variable", () => go(["install"], { env: { INCLUDE_ORG: "1" } }));
  // R22(j) is not exercised: the failing render returns 1 in the shell as well (both statuses are 1).
  check("a failing extension stops the loop", () =>
    go(["install"], {}, (b) => (some(b), ext(b, "core", "aaa", false))),
  );
  check("hello-world (the real extension)", () =>
    go(["install", "hello-world"], {}, (b) => placeHello(b)),
  );
});

describe("link, unlink", () => {
  const go = (name: string, args: string[], o: TwinOptions = {}, setup = some) =>
    twin(setup, name, args, o);
  check("link-extensions", () => go("link-extensions", []));
  check("link-extensions --include-org", () => go("link-extensions", ["--include-org"]));
  check("unlink-extensions", () => go("unlink-extensions", [], {}, (b) => (some(b), installed(b))));
  check("unlink-extensions, INCLUDE_ORG", () =>
    go("unlink-extensions", [], { env: { INCLUDE_ORG: "1" } }, (b) => (some(b), installed(b))),
  );
  check("unlink-component: removes", () =>
    go("unlink-component", ["extensions", "alpha"], {}, (b) => (some(b), installed(b))),
  );
  check("unlink-component: alias", () =>
    go("unlink-component", ["policy", "x"], {}, (b) =>
      fs.mkdirSync(`${b.home}/.gemini/policies/x`, { recursive: true }),
    ),
  );
  check("unlink-component: not found", () => go("unlink-component", ["skills", "x"]));
  check("unlink-component: usage", () => go("unlink-component", ["skills"]), [USAGE_PREFIX]); // deviation: R22(i)
});

const COPY =
  `n=$(sed -n 's/^ *"name": *"\\([^"]*\\)".*/\\1/p' "$3/plugin.json" | head -1)\n` +
  `d="$HOME/.gemini/config/plugins/$n"\nmkdir -p "$d"\ncp -R "$3/." "$d/"\n`;
const hello = (b: InstallSandbox): void => placeHello(b);
const withStubs = (b: InstallSandbox): void => {
  placeHello(b);
  stubCli(b, "agy", { body: COPY });
};
const MARKETPLACE = {
  name: "crewrig-local",
  owner: { name: "x" },
  plugins: [{ name: "old", source: "./old" }],
};

describe("plugin installers", () => {
  const go = (name: string, args: string[], setup = hello) => twin(setup, name, args);
  const seedMarket = (b: InstallSandbox): void => {
    hello(b);
    const dir = `${b.home}/.claude/local-marketplace/.claude-plugin`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/marketplace.json`, JSON.stringify(MARKETPLACE, null, 2));
  };
  const refuse = (b: InstallSandbox): void => {
    hello(b);
    stubCli(b, "claude", { status: 1, stderr: "no\n" });
  };
  check("claude plugin", () => go("install-claude-plugin", ["hello-world"]));
  check("claude plugin: marketplace upsert over an existing file", () =>
    go("install-claude-plugin", ["hello-world"], seedMarket),
  );
  check("claude plugin: refusing claude", () =>
    go("install-claude-plugin", ["hello-world"], refuse),
  );
  check("claude plugin: usage", () => go("install-claude-plugin", []), [USAGE_PREFIX_ERR]); // deviation: R22(i)
  check("copilot plugin", () => go("install-copilot-plugin", ["hello-world"]));
  check("copilot plugin: not found", () => go("install-copilot-plugin", ["nope"]));
  check("copilot plugin: usage", () => go("install-copilot-plugin", []), [USAGE_PREFIX_ERR]); // deviation: R22(i)
  check("antigravity extension", () =>
    go("install-antigravity-extension", ["hello-world"], withStubs),
  );
  check("antigravity extension: usage", () => go("install-antigravity-extension", []), [
    USAGE_PREFIX_ERR,
  ]); // deviation: R22(i)
});

describe("install-workspace, install-extension-all", () => {
  const stub =
    (fail: boolean) =>
    (b: InstallSandbox): void => {
      const bad = fail ? 'case "$2" in themes) echo bad >&2; exit 3;; esac\n' : "";
      b.tree.write(
        "scripts/manage-workspace-component.sh",
        `#!/bin/bash\necho "child $*"\n${bad}`,
        0o755,
      );
      const ts = fail
        ? 'if (process.argv[3] === "themes") { console.error("bad"); process.exitCode = 3; }\n'
        : "";
      b.tree.write(
        "scripts/manage-workspace-component.ts",
        `console.log("child " + process.argv.slice(2).join(" "));\n${ts}`,
      );
    };
  check("install-workspace: one failing type", () =>
    twin(stub(true), "install-workspace", ["link"]),
  );
  check("install-workspace: every type ok", () => twin(stub(false), "install-workspace", []));
  check("install-extension-all: every CLI", () =>
    twin(withStubs, "install-extension-all", ["hello-world"]),
  );
  check("install-extension-all: usage", () => twin(withStubs, "install-extension-all", []));
  check("install-extension-all: a failing claude", () =>
    twin((b) => (withStubs(b), stubCli(b, "claude", { status: 1 })), "install-extension-all", [
      "hello-world",
    ]),
  );
  check("install-extension-all: no copilot, no agy", () =>
    twin(hello, "install-extension-all", ["hello-world"], { clis: ["claude", "gemini"] }),
  );
});
