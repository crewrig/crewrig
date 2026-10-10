// component-twins-conformance.test.ts — the TypeScript twins of scripts/lib/component-resolve.sh
// (roots, resolution, reporting, overlay refresh, install drivers) against the shell, over one
// fixture matrix, on stdout, stderr, status and the tree left behind (spec 0255, row F2).
// Linux and macOS only: it spawns `bash`, and retires with the shell libraries (row J4). The
// migration twin is compared in component-twins-conformance-migrate.test.ts.

import { after, describe, test } from "node:test";

import { componentInstallAll, componentInstallNamed } from "../lib/component-install.ts";
import { ensureOverlayTiersFresh } from "../lib/component-overlay.ts";
import * as roots from "../lib/component-roots.ts";
import {
  cleanup,
  dump,
  runShell,
  runTwin,
  same,
  SKIP,
  STUBS,
  type Layout,
  type Streams,
} from "./lib/component-twins-harness.ts";

after(cleanup);

const STAGING = ".claude/skills";
const skill = (tier: string, name: string): Layout => ({
  [`dist/${tier}/${STAGING}/${name}/SKILL.md`]: `# ${name}\n`,
});
const emptyTier = (tier: string): Layout => ({ [`dist/${tier}/${STAGING}/`]: "" });

/** Compare shell `body` against twin `fn` on one layout. */
const check = (
  layout: Layout,
  body: string,
  fn: (s: Streams) => number,
  env: Record<string, string> = {},
): void => same(runShell(layout, body, env), runTwin(layout, fn, env));

const STAGE = `component_set_staging_roots ${STAGING}\n`;
const stage = (s: Streams): string[] => roots.setStagingRoots(s.sb, STAGING);
const rec =
  (s: Streams) =>
  (p: string): number => {
    s.out(`install ${p}\n`);
    return p.includes("fail") ? 7 : 0;
  };
const io = (s: Streams) => ({ repoDir: s.sb, stderr: s.err });

describe("roots and resolution", { skip: SKIP }, () => {
  test("staging and artifact roots are produced in tier order, present or not", () => {
    const body = `${STAGE}dump "\${COMPONENT_ROOTS[@]}"\ncomponent_set_artifact_roots policies\ndump "\${COMPONENT_ROOTS[@]}"`;
    check({}, body, (s) => {
      s.out(dump(stage(s)) + dump(roots.setArtifactRoots(s.sb, "policies")));
      return 0;
    });
  });

  test("component_read_lines keeps the non-empty lines, in order", () => {
    const text = "a\n\nb c\n\n\nd";
    const body = `component_read_lines $'${text.replaceAll("\n", "\\n")}'\ndump "\${COMPONENT_LINES[@]}"`;
    check({}, body, (s) => (s.out(dump(roots.readLines(text))), 0));
  });

  test("tiers in order: every root's first candidate is collected, absent tiers skipped", () => {
    const layout: Layout = {
      [`dist/library/${STAGING}/alpha/SKILL.md`]: "",
      [`dist/library/${STAGING}/both`]: "",
      [`dist/library/${STAGING}/both.md`]: "",
      [`dist/community/${STAGING}/alpha.md`]: "",
      [`dist/org/${STAGING}/t.toml`]: "",
      [`dist/org/${STAGING}/j.json`]: "",
    };
    const names = ["alpha", "both", "t", "j", "nope", "with space"];
    const body = `${STAGE}for n in ${names.map((n) => `'${n}'`).join(" ")}; do echo "# $n"; resolve_component_in_roots "$n" "\${COMPONENT_ROOTS[@]}"; done`;
    check(layout, body, (s) => {
      for (const n of names)
        s.out(
          `# ${n}\n${roots
            .resolveComponentInRoots(n, stage(s))
            .map((p) => `${p}\n`)
            .join("")}`,
        );
      return 0;
    });
  });

  test("enumeration: C-locale order, hidden and dangling entries skipped, files kept", () => {
    const layout: Layout = {
      ...skill("library", "beta"),
      ...skill("library", "Alpha"),
      [`dist/library/${STAGING}/.gitkeep`]: "",
      [`dist/library/${STAGING}/.hidden`]: "",
      [`dist/library/${STAGING}/z file.md`]: "",
      [`dist/community/${STAGING}/beta.md`]: "",
      ...emptyTier("org"),
    };
    const body = `${STAGE}enumerate_components_in_roots "\${COMPONENT_ROOTS[@]}"`;
    check(layout, body, (s) => {
      for (const e of roots.enumerateComponentsInRoots(stage(s))) s.out(`${e.base}\t${e.path}\n`);
      return 0;
    });
  });

  for (const [label, layout] of [
    ["no served root at all: the build hint", {}],
    ["some roots present: no hint", emptyTier("community")],
  ] as const)
    test(`report_unresolved, ${label}`, () => {
      const body = `${STAGE}report_unresolved "ghost" skills "\${COMPONENT_ROOTS[@]}"; exit 0`;
      check(layout, body, (s) => (roots.reportUnresolved("ghost", "skills", stage(s), s.err), 0));
    });
});

describe("ensure_overlay_tiers_fresh", { skip: SKIP }, () => {
  const tiers = "library community org";
  const layout: Layout = { ...STUBS, ...skill("library", "old"), ...skill("org", "old2") };
  const cases: [string, string, string[], Record<string, string>][] = [
    ["a successful rebuild empties the roots first", "claude", tiers.split(" "), {}],
    [
      "a refused rebuild names the pruned roots and the child's output",
      "claude",
      tiers.split(" "),
      { STUB_STATUS: "3" },
    ],
    ["the core tier is refused before anything is removed", "claude", ["library", "core"], {}],
    ["an unknown CLI is an internal error", "vim", tiers.split(" "), {}],
    ["no tier: the rebuild runs with no tier argument", "gemini", [], {}],
  ];
  for (const [label, cli, list, env] of cases)
    test(label, () => {
      const body = `ensure_overlay_tiers_fresh ${cli} ${list.join(" ")}`;
      check(layout, body, (s) => ensureOverlayTiersFresh(cli, list, io(s)), env);
    });
});

describe("install drivers", { skip: SKIP }, () => {
  const named = (name: string, refresh: string): string =>
    `${STAGE}component_install_named rec ${name} skills '${refresh}' "\${COMPONENT_ROOTS[@]}"`;
  const twinNamed =
    (name: string, refresh: string) =>
    (s: Streams): number =>
      componentInstallNamed(rec(s), name, "skills", refresh, stage(s), io(s));

  test("named: a single hit installs without a rebuild", () => {
    const layout = { ...STUBS, ...skill("library", "alpha") };
    check(layout, named("alpha", "claude"), twinNamed("alpha", "claude"), { STUB_STATUS: "9" });
  });
  test("named: a collision across tiers is refused, nothing installed, no rebuild", () => {
    const layout = { ...STUBS, ...skill("library", "alpha"), ...skill("org", "alpha") };
    check(layout, named("alpha", "claude"), twinNamed("alpha", "claude"));
  });
  test("named: an unresolved name without a refresh CLI is reported", () => {
    check({ ...STUBS, ...emptyTier("org") }, named("ghost", ""), twinNamed("ghost", ""));
  });
  test("named: a stale overlay is rebuilt once on a miss, then resolved", () => {
    const env = { STUB_POPULATE: `dist/library/${STAGING}/fresh/SKILL.md` };
    check({ ...STUBS }, named("fresh", "claude"), twinNamed("fresh", "claude"), env);
  });
  test("named: a rebuild that finds nothing reports the miss after the rebuild", () => {
    check({ ...STUBS }, named("ghost", "claude"), twinNamed("ghost", "claude"));
  });
  test("named: a refused rebuild's status is returned", () => {
    check({ ...STUBS }, named("ghost", "claude"), twinNamed("ghost", "claude"), {
      STUB_STATUS: "4",
    });
  });
  test("named: the installer's own status is returned", () => {
    const layout = { ...STUBS, ...skill("library", "will-fail") };
    check(layout, named("will-fail", ""), twinNamed("will-fail", ""));
  });

  const all = (refresh: string): string =>
    `${STAGE}component_install_all rec '${refresh}' "\${COMPONENT_ROOTS[@]}"`;
  const twinAll =
    (refresh: string) =>
    (s: Streams): number =>
      componentInstallAll(rec(s), refresh, stage(s), io(s));
  const matrix: Layout = {
    ...STUBS,
    ...skill("library", "beta"),
    ...skill("library", "Alpha"),
    ...skill("community", "beta"),
    ...skill("org", "will-fail"),
    [`dist/org/${STAGING}/.gitkeep`]: "",
  };
  test("all: tiers in order, a collision defers a failure, a failing installer too", () => {
    check(matrix, all(""), twinAll(""));
  });
  test("all: a refresh CLI rebuilds first, unconditionally, and prunes", () => {
    check(matrix, all("claude"), twinAll("claude"));
  });
  test("all: a refused rebuild returns its status before enumerating", () => {
    check(matrix, all("claude"), twinAll("claude"), { STUB_STATUS: "5" });
  });
  test("all: nothing to enumerate is success", () => {
    check({ ...STUBS }, all(""), twinAll(""));
  });
});
