// mapping-fixtures.ts — TypeScript builders for the inline mapping and profile fixtures of
// scripts/tests/test-model-resolution.sh (spec 0250 R21). Each builder carries the
// `# --- <label>` heading of the Bash section it re-expresses; the conformance guard fails
// when a fixture-defining section has neither a builder nor a listed exemption, so the Bash
// cases cannot silently drift from this file. Mutations use the Bash suite's own `yq`
// expressions: the property under test is how two readers load one document.
//
// The cases are one row each in two tables, parsed below. A row is
//   label § name § targets § kind § profiles [§ core]
// with kind `-` (the real mappings), `yq:<expression>` (a mutated copy of <target>.yml),
// `org:<body>` (a <target>.org.yml; `¶` is a line feed, `→` a tab, `{off:id,rank,native,intel}` an
// offering, `{fm:id,value}` a frontmatter surface, `{ambiguous}` scalar spellings that `yq`
// normalises) or `silent` (the shipped stub). Profiles are `;;`-separated groups of
// `;`-separated lines (`i=` is `intelligence: `, `r=` is `reasoning: `), or `@canon`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { REPO, type ResolveCase } from "./shell-resolve-harness.ts";

/** `metadata.model` lines of an agent source, or the path of a ready source file. */
export type Profile = readonly string[] | string;

export interface Builder {
  /** The `# --- <label>` heading of the Bash section ("extra" for a case the suite lacks). */
  readonly label: string;
  readonly name: string;
  readonly targets: readonly string[];
  readonly profiles: readonly Profile[];
  /** Creates the `REPO_DIR` root under `tmp`. */
  readonly build: (tmp: string) => string;
  /** True when the root carries an organisation channel file (the merge is exercised). */
  readonly org?: boolean;
}

const MM = path.join(REPO, "model-mappings");
const CANON = path.join(
  REPO,
  "scripts/tests/fixtures/agent-profiles/canonical-medium-reasoning.md",
);

/** The Bash suite's `write_fixture`: lines auto-indented under `metadata: model:`. */
export function agentSource(lines: readonly string[]): string {
  const meta = ["metadata:", "  model:", ...lines.map((l) => `    ${l}`)];
  return ["---", "name: probe", 'description: "Probe agent."', ...meta, "---", "Body.", ""].join(
    "\n",
  );
}

function copyMappings(tmp: string, name: string): string {
  const dir = path.join(tmp, name, "model-mappings");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(MM)) fs.copyFileSync(path.join(MM, f), path.join(dir, f));
  return path.dirname(dir);
}
const put = (dir: string, file: string, text: string): void =>
  fs.writeFileSync(path.join(dir, "model-mappings", file), text);

const GROUNDS = ["native-value", "provides.intelligence", "supports-reasoning-surface"];
/** One org offering as the Bash O-cases write it; a `-` rank writes none. */
const off = (id: string, rank: string, native: string, intel: string): string =>
  [
    `  - id: ${id}`,
    ...(rank === "-" ? [] : [`    rank: ${rank}`]),
    `    native-value: ${native}\n    provides:\n      intelligence: ${intel}`,
    `      specialization: general\n    encodes:\n      intelligence: ${id}`,
    "    supports-reasoning-surface: false\n    grounds:",
    ...GROUNDS.map((d) => `      - declares: ${d}\n        assumption: fixture`),
  ].join("\n");
const fm = (id: string, v: string): string =>
  `surfaces:\n  - id: ${id}\n    kind: frontmatter\n    items:\n      - item: model\n        key: model\n        domain:\n          values: [${v}]\n        grounds:\n          - declares: key\n            assumption: fixture`;
const AMBIGUOUS = `  - id: "true"\n    rank: 40\n    native-value: "null"\n    provides:\n      intelligence: high\n      context: "007"\n      speed: "1e3"\n      locality: "~"\n    encodes:\n      reasoning:\n    supports-reasoning-surface: "true"\n  - id: ~\n    rank: 41\n    native-value: 0.0\n    provides:\n      intelligence: high\n      specialization: ~\n      context:\n      modalities: [text, "yes", 0x1F, ~, "", 007]\n  - id: yes\n    rank: 42\n    native-value: |\n      multi\n        line\n    provides: {}\n    extra: {nested: {deep: [1, "two", True, null, "", {k: v}], empty: {}, e2: []}}`;
const expandBody = (body: string): string =>
  body
    .replaceAll("¶", "\n")
    .replaceAll("→", "\t")
    .replace(/\{(off|fm):([^}]*)\}/g, (_, k: string, a: string) => {
      const [x = "", y = "", z = "", w = ""] = a.split(",");
      return k === "off" ? off(x, y, z, w) : fm(x, y);
    })
    .replace("{ambiguous}", AMBIGUOUS);
const expandProfile = (group: string): Profile =>
  group === "@canon"
    ? CANON
    : group.split(";").map((l) => l.replace(/^i=/, "intelligence: ").replace(/^r=/, "reasoning: "));

function parse(table: string): Builder[] {
  const rows = table.split("\n").filter((l) => l.trim() !== "");
  return rows.map((row): Builder => {
    const [label = "", name = "", targets = "", kind = "-", profiles = "", core] = row
      .split("§")
      .map((f) => f.trim());
    const list = targets.split(",");
    const isOrg = kind.startsWith("org:") || kind === "silent";
    const groups = profiles === "" ? ["i=medium;r=medium", "i=max"] : profiles.split(";;");
    const build = (tmp: string): string => {
      if (kind === "-") return REPO;
      const [dir, target] = [copyMappings(tmp, name), list[0] ?? ""];
      if (kind.startsWith("yq:")) {
        execFileSync("yq", [
          "eval",
          "-i",
          kind.slice(3),
          path.join(dir, "model-mappings", `${target}.yml`),
        ]);
      }
      if (kind === "silent")
        put(dir, "claude.org.yml", fs.readFileSync(path.join(MM, "claude.org.yml"), "utf8"));
      if (kind.startsWith("org:")) put(dir, `${target}.org.yml`, `${expandBody(kind.slice(4))}\n`);
      if (core !== undefined) put(dir, `${target}.yml`, expandBody(core === "<empty>" ? "" : core));
      return dir;
    };
    const profileList = groups.map((g) => expandProfile(g.trim()));
    return {
      label,
      name,
      targets: list,
      profiles: profileList,
      build,
      ...(isOrg ? { org: true } : {}),
    };
  });
}

const A4 = "claude,gemini,copilot,antigravity";
const SEL = '(.surfaces[] | select(.id == "guidance") | .template)';
const M4 =
  '{"id":"m4-cheap","rank":0,"native-value":"m4-cheap","encodes":{"intelligence":"m4-cheap"},"provides":{"intelligence":"xhigh","specialization":"general"},"supports-reasoning-surface":false,"grounds":[{"declares":"native-value","assumption":"mutation fixture"}]}';
const ENC = (r: string, i: number): string => `.offerings[${i}].encodes.reasoning = "${r}"`;
const SRS = '.offerings[0]["supports-reasoning-surface"]';

/** Re-expressions of the inline fixtures of the Bash suite, one per `# --- <label>` section. */
export const BUILDERS: readonly Builder[] = parse(String.raw`
C1 § C1_claude § claude § - § i=medium;r=medium
C3 § C3_rungs § ${A4} § - § i=minimal;;i=low;;i=medium;;i=high;;i=xhigh;;i=xxhigh;;i=max
C4 § C4_antigravity § antigravity § - § i=medium;r=high
C5 § C5_copilot § copilot § - § i=xhigh;r=high
C6 § C6_nomapping § no-such-target-at-all § - § i=xhigh;r=high;context: 500
C7 § C7_mut § gemini § yq:.offerings[1]."native-value" = "not-a-domain-member" § i=medium
C13(i) § C13i_claude § claude § - § i=medium
Rule (b) exhaustiveness § ruleb_claude § claude § - § r=medium
R7's tail clause § R7_gemini § gemini § - § r=medium;tuning:;  temperature: 0.5;  max-turns: 7
rule (d) § ruled_claude § claude § - § i=medium;context: 1000000
rule (d) § ruled_gemini § gemini § - § i=high;specialization: image-generation
rule (e) § rulee_antigravity § antigravity § - § i=high;r=medium
R24/D16 § R24_D16 § claude,antigravity § - § i=medium;tuning:;  temperature: 0.5
(g)(6) § g6_gemini § gemini § - § i=medium;tuning:;  temperature: 5.0
(g)(5) § g5_claude § claude § - § i=high;r=none
D12/D17's second disjunct § D12_mut § claude § yq:.offerings = [] § i=medium;r=medium
C10 § C10_mut § claude § yq:del(.surfaces[] | select(.id == "guidance")) § i=medium;r=medium
C9 § C9_mut § claude § yq:.offerings[0]."native-value" = "haiku-drifted" § @canon
M7 § M7_claude § claude § - § r=medium
M7 § M7_directed § claude § yq:.guard.state = "directed" § @canon
C12 § C12_canonical § ${A4} § - § @canon
C13(iii) § C13iii_claude § claude § - § i=medium
C13(ii) § C13ii_gemini § gemini § - § i=medium
R21 accept branch § R21_gemini § gemini § - § i=high;tuning:;  temperature: 0.7;  max-turns: 12
M1 § M1_mut § claude § yq:.offerings[0]."native-value" = "haiku-mutated-M1" § i=medium
M2 § M2_mut § claude § yq:${SRS} = false § i=medium;r=medium;;i=medium
M3 § M3_mut § claude § yq:.guard.state = "directed" § i=medium
M4 § M4_mut § claude § yq:.offerings += [${M4}] § i=xhigh
M5 § M5_mut § claude § yq:${SEL} = "Run this agent on the {{modell}} model.\nGive its work {{reasoning}} effort.\n" § i=medium;r=medium
M6 § M6_mut § claude § yq:${SRS} = false | ${ENC("medium", 0)} § i=medium;r=medium
O1 § O1_silent § claude § silent § i=medium
O2 § O2_replace § claude § org:target: claude¶offerings:¶{off:opus,3,opus-org-o2,xhigh} § i=xhigh
O3 § O3_add § claude § org:target: claude¶offerings:¶{off:o3-super,10,o3-super-native,max} § i=max
O4 § O4_remove § claude § org:target: claude¶remove: [offerings/sonnet] § i=medium;;i=high;;i=xhigh;;i=xxhigh;;i=max
O5 § O5_subst § claude § org:target: claude¶replaces-core: true¶surfaces:¶  - id: guidance¶    kind: guidance¶    carries: [model]¶    template: |¶      ORG template using {{model}}.¶    items:¶      - item: model¶offerings:¶{off:o5-only,1,o5-only-native,medium} § i=medium
O6 § O6_copilot § copilot § org:target: copilot¶{fm:agent-file-model,o6-model}¶offerings:¶{off:o6-offering,1,o6-model,medium} § i=medium
O6b § O6b_nocore § o6bfake § org:target: o6bfake¶remove: [offerings/nonexistent]¶{fm:fm,o6b-model}¶offerings:¶{off:o6b-offering,1,o6b-model,medium} § i=medium
O7 § O7_ties § claude § org:target: claude¶offerings:¶{off:o7-zzz,5,o7-zzz-native,high}¶{off:o7-aaa,5,o7-aaa-native,high} § i=high
O9 § O9_duprank § claude § org:target: claude¶offerings:¶{off:zzz-dup,2,zzz-dup-native,high} § i=high
O10 § O10_extra § claude § org:target: claude¶offerings:¶{off:o10-org-extra,21,o10-org-extra-native,max} § @canon
O11 § O11_claude § claude § org:target: claude¶offerings:¶{off:o11-extra-claude,20,o11-extra-native,max} § i=medium
O11 § O11_gemini § gemini § org:target: gemini¶offerings:¶{off:o11-extra-gemini,20,o11-extra-native,max} § i=medium
O11 § O11_copilot § copilot § org:target: copilot¶offerings:¶{off:o11-extra-copilot,20,o11-extra-native,max} § i=medium
O11 § O11_antigravity § antigravity § org:target: antigravity¶offerings:¶{off:o11-extra-antigravity,20,o11-extra-native,max} § i=medium
O12 § O12_rmguard § claude § org:target: claude¶remove: [guard] § i=medium;r=medium
extra § x_rank_nonnumeric § claude § yq:.offerings[1].rank = 1 | .offerings[0].rank = "x" § i=medium
extra § x_context § claude § yq:.offerings[0].provides.context = 100000 | .offerings[1].provides.context = 200000 | .offerings[2].provides.context = 1000000 § i=medium;context: 150000;;i=medium;context: 1000000;;i=medium;context: 99999999999999999999;;i=medium;context: abc
extra § x_axes § gemini § yq:.offerings[0].provides.speed = "fast" | .offerings[1].provides.locality = "local" | .offerings[0].provides.modalities = ["text","image"] § i=medium;speed: fast;;i=medium;locality: local;;i=medium;modalities: [text, image];;i=medium;specialization: coding;;i=medium;speed: standard
extra § x_encoded § claude § yq:${ENC("low", 0)} | ${ENC("high", 1)} | ${ENC("xhigh", 2)} | ${SRS} = true § i=medium;r=low;;i=medium;r=high;;i=medium;r=xhigh
extra § x_template § claude § yq:${SEL} = "Run on {{model}}.\n\n  Effort {{reasoning}}.  \nplain \"quote\"\nunknown {{nope}} here\n" § i=medium;r=medium
extra § x_matrix_reasoning § ${A4} § - § i=medium;r=none;;i=medium;r=low;;i=medium;r=medium;;i=medium;r=high;;i=medium;r=max;;i=medium;r=bogus;;i=high;r=high;;i=max;r=max;;i=bogus;r=low;;r=high
extra § x_matrix_axes § ${A4} § - § i=medium;specialization: coding;;i=medium;specialization: bogus;;i=medium;context: 200000;;i=medium;speed: fast;;i=medium;locality: local;;i=medium;modalities: [audio];;i=medium;modalities: [text, image]
extra § x_matrix_tuning § ${A4} § - § i=medium;tuning:;  temperature: 1.5;  top-p: 0.9;  top-k: 40;;i=medium;tuning:;  temperature: 3.0;  max-turns: 0;;i=medium;tuning:;  max-output-tokens: 4096;  max-turns: x;  foo: 1
`);

const X = "{off:x,1,x,medium}";
/** Organisation edge cases beyond the Bash suite: ambiguous scalars, rank spellings, bad files. */
export const ORG_EDGES: readonly Builder[] = parse(String.raw`
extra § xo_guard-id § claude § org:target: claude¶guard:¶  id: g2¶  state: directed¶  terms:¶    - id: t1¶      holds: true
extra § xo_guard-terms § claude § org:target: claude¶guard:¶  terms:¶    - id: defect-not-established-fixed¶      holds: false¶    - id: brand-new¶      holds: true
extra § xo_guard-nocore § gemini § org:target: gemini¶guard:¶  state: withheld¶  terms:¶    - id: a¶      holds: true
extra § xo_subst-guard § claude § org:target: claude¶replaces-core: true¶guard:¶  id: g¶  state: directed¶offerings:¶${X}
extra § xo_template § claude § org:target: claude¶surfaces:¶  - id: guidance¶    template: |¶      Org says {{model}} and {{reasoning}}.¶  - id: brandnew¶    template: x
extra § xo_remove-paths § claude § org:target: claude¶remove: [surfaces/guidance, surfaces/nonexist, surfaces//template, guard/state, guard/state, other/thing, "", ~]
extra § xo_dup-groups § claude § org:target: claude¶offerings:¶{off:d2,7,n2,high}¶{off:d1,7,n1,high}¶{off:e2,1,ne2,low}¶{off:e1,1,ne1,low}
extra § xo_ambiguous-scalars § claude § org:target: claude¶offerings:¶{ambiguous}
extra § xo_rank-absent § claude § org:target: claude¶offerings:¶{off:norank,-,n-norank,max}¶{off:norank2,-,n-norank2,max} § i=medium;r=medium;;i=max
extra § xo_rank-absent-subst § claude § org:target: claude¶replaces-core: true¶offerings:¶{off:only-a,-,n-a,max}¶{off:only-b,-,n-b,max} § i=max
extra § xo_rank-hex § claude § org:target: claude¶offerings:¶{off:hexa,0x10,hexa-native,high}¶{off:hexb,0x2,hexb-native,high}
extra § xo_rank-hex-float § claude § org:target: claude¶offerings:¶{off:hexa,0x10,hexa-native,max}¶{off:flt,1.5,flt-native,max} § i=medium;r=medium;;i=max
extra § xo_unparseable-org § claude § org:target: claude¶→offers: [
extra § xo_empty-org § claude § org:
extra § xo_seq-org § claude § org:- a¶- b
extra § xo_nonseq-offerings § claude § org:target: claude¶offerings:¶  a: 1¶surfaces: abc¶remove: foo
extra § xo_core-unparseable § claude § org:target: claude¶offerings:¶${X} § § →:::[ broken
extra § xo_core-empty § claude § org:target: claude¶offerings:¶${X} § § <empty>
extra § xo_core-seq § claude § org:target: claude¶offerings:¶${X} § § - a¶
`);

/** Bash sections that define a fixture re-expressed by another builder or that are no resolution input. */
export const EXEMPT_LABELS: Readonly<Record<string, string>> = {
  "R30 build-twice diff": "build-twice idempotence; its input is C12's canonical fixture",
  M11: "mutates the shell library; its root and profile are O9's",
};

/** Write each profile of a builder as an agent source and list its cases (profile x target). */
export function casesOf(
  b: Builder,
  tmp: string,
  repoDir: string,
  extra: Partial<ResolveCase> = {},
): ResolveCase[] {
  return b.profiles.flatMap((profile, i) => {
    let source = typeof profile === "string" ? profile : "";
    if (typeof profile !== "string") {
      source = path.join(tmp, `${b.name}-profile-${i}.md`);
      fs.writeFileSync(source, agentSource(profile));
    }
    const label = `${b.label}/${b.name}#${i}`;
    return b.targets.map((target) => ({
      label: `${label}/${target}`,
      repoDir,
      agent: "probe",
      source,
      target,
      ...extra,
    }));
  });
}
